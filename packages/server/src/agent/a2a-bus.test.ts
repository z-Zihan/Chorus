import type { AgentAdapter, ConversationContext, Message, StreamChunk } from "@chorus/shared";
import { MAX_A2A_CALL_TIMEOUT_MS, MIN_A2A_CALL_TIMEOUT_MS } from "@chorus/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HubMessageRouter } from "../hub/message-router";
import type { RelayClient } from "../hub/relay-client";
import { A2ABus } from "./a2a-bus";
import type { AgentRegistry } from "./registry";

type A2AAdapter = Pick<AgentAdapter, "handleA2ACall">;

interface RegistryOverrides {
  get?: (id: string) => { id: string; name: string } | undefined;
  getAdapter?: (id: string) => A2AAdapter | undefined;
  getStatus?: (id: string) => string;
  getRemoteAgentHub?: (id: string) => string | undefined;
  getRemoteAgentSourceId?: (id: string) => string | undefined;
}

function createRegistry(adapter: A2AAdapter, overrides: RegistryOverrides = {}): AgentRegistry {
  return {
    get: (id: string) => ({ id, name: id }),
    getAdapter: (id: string) => (id === "callee" ? adapter : undefined),
    getStatus: () => "online",
    getRemoteAgentHub: () => undefined,
    getRemoteAgentSourceId: () => undefined,
    ...overrides,
  } as unknown as AgentRegistry;
}

const defaultOptions = { maxDepth: 5, callTimeoutMs: 5 * 60_000, maxConcurrency: 3 };

function doneAdapter() {
  const handleA2ACall = vi.fn<NonNullable<AgentAdapter["handleA2ACall"]>>(async function* () {
    yield { type: "text", content: "ok" };
    yield { type: "done", content: "" };
  });
  return { adapter: { handleA2ACall } as A2AAdapter, handleA2ACall };
}

async function collect(stream: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function message(fromType: Message["fromType"], fromId: string, content: string): Message {
  return {
    id: `${fromId}-${content.length}`,
    conversationId: "conversation-1",
    fromType,
    fromId,
    content,
    timestamp: 0,
    status: "done",
  };
}

function deferredCallAdapter(): {
  adapter: Pick<AgentAdapter, "handleA2ACall">;
  release: (index: number) => void;
  waitForStarts: (count: number) => Promise<void>;
} {
  let started = 0;
  const pending: (() => void)[] = [];
  const adapter = {
    handleA2ACall: async function* () {
      const index = started++;
      await new Promise<void>((resolve) => {
        pending[index] = resolve;
      });
      yield { type: "done", content: "" };
    },
  } as Pick<AgentAdapter, "handleA2ACall">;
  const waitForStarts = async (count: number) => {
    while (started < count) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { adapter, waitForStarts, release: (index) => pending[index]?.() };
}

describe("A2ABus concurrency accounting", () => {
  it("decrements the per-agent counter so overlapping calls neither leak nor bypass the limit", async () => {
    const { adapter, release, waitForStarts } = deferredCallAdapter();
    const registry = createRegistry(adapter);
    const bus = new A2ABus(registry, {
      maxDepth: 5,
      callTimeoutMs: 5 * 60_000,
      maxConcurrency: 2,
    });
    // Drain the whole stream: the bus only releases the concurrency slot in its
    // generator's finally, which runs once the consumer completes iteration.
    const call = () =>
      (async () => {
        const stream = bus.call("caller", "callee", "work", {
          conversationId: "conversation-1",
          history: [],
          callStack: ["caller"],
        });
        let step = await stream.next();
        while (!step.done) step = await stream.next();
      })();

    const first = call();
    const second = call();
    await waitForStarts(2);

    // First finishes while the second is still running: its cleanup must not
    // wipe the second call's counter entry (the old restore-snapshot bug).
    release(0);
    await first;
    release(1);
    await second;

    // After both calls the counter must be fully released: two fresh calls fit
    // again under maxConcurrency=2...
    const third = call();
    const fourth = call();
    await waitForStarts(4);

    // ...and a fifth is rejected while two are active.
    const fifth = bus.call("caller", "callee", "work", {
      conversationId: "conversation-1",
      history: [],
      callStack: ["caller"],
    });
    const chunks: unknown[] = [];
    for await (const chunk of fifth) chunks.push(chunk);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: "error" });

    release(2);
    release(3);
    await third;
    await fourth;
  });
});

describe("A2ABus time limits", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the per-task call timeout instead of the former 60-second limit", async () => {
    vi.useFakeTimers();
    const adapter = {
      handleA2ACall: async function* (
        _from: string,
        _message: string,
        context: ConversationContext,
      ) {
        await new Promise<never>((_, reject) => {
          const abort = () => reject(context.signal?.reason);
          context.signal?.addEventListener("abort", abort, { once: true });
        });
      },
    } as Pick<AgentAdapter, "handleA2ACall">;
    const registry = createRegistry(adapter);
    const bus = new A2ABus(registry, {
      maxDepth: 5,
      callTimeoutMs: 5 * 60_000,
      maxConcurrency: 3,
    });
    const call = bus
      .call("caller", "callee", "work", {
        conversationId: "conversation-1",
        history: [],
        callStack: ["caller"],
        a2aCallTimeoutMs: 2 * 60_000,
      })
      .next()
      .then(() => undefined);
    const assertion = expect(call).rejects.toMatchObject({
      name: "TimeoutError",
      message: "Agent call timed out after 2 minutes",
    });

    await vi.advanceTimersByTimeAsync(60_000);
    let settled = false;
    void call.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });
});

describe("A2ABus call guards", () => {
  it("rejects a call that would re-enter an agent already on the stack", async () => {
    const { adapter, handleA2ACall } = doneAdapter();
    const bus = new A2ABus(createRegistry(adapter), defaultOptions);

    const chunks = await collect(
      bus.call("callee", "caller", "work", {
        conversationId: "conversation-1",
        history: [],
        callStack: ["caller", "callee"],
        a2aThreadId: "thread-cycle",
      }),
    );

    expect(chunks).toEqual([
      {
        type: "error",
        content: "检测到循环调用: caller → callee → caller",
        threadId: "thread-cycle",
      },
    ]);
    expect(handleA2ACall).not.toHaveBeenCalled();
  });

  it("rejects a call once the stack reaches maxDepth", async () => {
    const { adapter, handleA2ACall } = doneAdapter();
    const bus = new A2ABus(createRegistry(adapter), { ...defaultOptions, maxDepth: 2 });

    const chunks = await collect(
      bus.call("middle", "callee", "work", {
        conversationId: "conversation-1",
        history: [],
        callStack: ["caller", "middle"],
      }),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ type: "error", content: "超过最大调用深度 2" });
    expect(handleA2ACall).not.toHaveBeenCalled();
  });

  it("surfaces the authorizer's denial without invoking the target", async () => {
    const { adapter, handleA2ACall } = doneAdapter();
    const authorize = vi.fn(async () => ({ approved: false, error: "用户拒绝了调用" }));
    const bus = new A2ABus(createRegistry(adapter), defaultOptions, undefined, authorize);

    const chunks = await collect(
      bus.call("caller", "callee", "work", {
        conversationId: "conversation-1",
        history: [],
        a2aThreadId: "thread-auth",
      }),
    );

    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation-1",
        threadId: "thread-auth",
        fromAgentId: "caller",
        toAgentId: "callee",
        message: "work",
      }),
    );
    expect(chunks).toEqual([
      {
        type: "error",
        content: "用户拒绝了调用",
        threadId: "thread-auth",
        sourceAgentId: "callee",
      },
    ]);
    expect(handleA2ACall).not.toHaveBeenCalled();
  });

  it("falls back to a default denial message when the authorizer gives none", async () => {
    const { adapter, handleA2ACall } = doneAdapter();
    const bus = new A2ABus(createRegistry(adapter), defaultOptions, undefined, async () => ({
      approved: false,
    }));

    const chunks = await collect(
      bus.call("caller", "callee", "work", { conversationId: "conversation-1", history: [] }),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      type: "error",
      content: "A2A 调用未获批准",
      sourceAgentId: "callee",
    });
    expect(handleA2ACall).not.toHaveBeenCalled();
  });

  it.each<[string, RegistryOverrides]>([
    ["the adapter is missing", { getAdapter: () => undefined }],
    ["the adapter cannot handle A2A calls", { getAdapter: () => ({}) as A2AAdapter }],
    ["the agent is offline", { getStatus: () => "offline" }],
  ])(
    "reports the target as unavailable when %s without holding a concurrency slot",
    async (_label, overrides) => {
      const { adapter, handleA2ACall } = doneAdapter();
      let available = false;
      const registry = createRegistry(adapter, {
        getAdapter: (id) =>
          available || !overrides.getAdapter ? adapter : overrides.getAdapter(id),
        getStatus: (id) => (available ? "online" : (overrides.getStatus?.(id) ?? "online")),
      });
      const bus = new A2ABus(registry, { ...defaultOptions, maxConcurrency: 1 });
      const context = { conversationId: "conversation-1", history: [] };

      const rejected = await collect(bus.call("caller", "callee", "work", context));
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({ type: "error" });
      expect(rejected[0]?.content).toContain("当前不可用");
      expect(handleA2ACall).not.toHaveBeenCalled();

      // With maxConcurrency=1, a leaked slot would turn this into a concurrency error.
      available = true;
      const accepted = await collect(bus.call("caller", "callee", "work", context));
      expect(accepted.map((chunk) => chunk.type)).toEqual(["text", "done"]);
      expect(handleA2ACall).toHaveBeenCalledTimes(1);
    },
  );

  it("accepts busy agents as call targets", async () => {
    const { adapter, handleA2ACall } = doneAdapter();
    const bus = new A2ABus(createRegistry(adapter, { getStatus: () => "busy" }), defaultOptions);

    const chunks = await collect(
      bus.call("caller", "callee", "work", { conversationId: "conversation-1", history: [] }),
    );

    expect(chunks.map((chunk) => chunk.type)).toEqual(["text", "done"]);
    expect(handleA2ACall).toHaveBeenCalledTimes(1);
  });
});

describe("A2ABus cross-hub routing", () => {
  function remoteSetup(
    options: {
      sourceId?: string;
      router?: boolean;
      relayState?: string;
    } = {},
  ) {
    const { adapter, handleA2ACall } = doneAdapter();
    const registry = createRegistry(adapter, {
      getRemoteAgentHub: (id) => (id.startsWith("hub-1") ? "hub-1" : undefined),
      getRemoteAgentSourceId: () => options.sourceId,
    });
    const relayClient = { state: options.relayState ?? "connected" } as unknown as RelayClient;
    const onRemoteDelivery = vi.fn();
    const callRemoteAgent = vi.fn<HubMessageRouter["callRemoteAgent"]>(
      async (_hub, _from, _to, _message, _context, onDeliveryStatus) => {
        onDeliveryStatus?.({ transport: "delivered" });
        return "remote reply";
      },
    );
    const bus = new A2ABus(registry, defaultOptions, relayClient, undefined, onRemoteDelivery);
    if (options.router !== false) {
      bus.setHubMessageRouter({ callRemoteAgent } as unknown as HubMessageRouter);
    }
    return { bus, callRemoteAgent, handleA2ACall, onRemoteDelivery };
  }

  const context = {
    conversationId: "conversation-1",
    history: [],
    callStack: ["caller"],
    a2aThreadId: "thread-remote",
  };

  it("errors when no hub message router is configured", async () => {
    const { bus, handleA2ACall } = remoteSetup({ router: false });

    const chunks = await collect(bus.call("caller", "hub-1:agent-x", "work", context));

    expect(chunks).toEqual([
      { type: "error", content: "跨 Hub 消息路由不可用", threadId: "thread-remote" },
    ]);
    expect(handleA2ACall).not.toHaveBeenCalled();
  });

  it("errors when the relay is not connected", async () => {
    const { bus, callRemoteAgent } = remoteSetup({ relayState: "disconnected" });

    const chunks = await collect(bus.call("caller", "hub-1:agent-x", "work", context));

    expect(chunks).toEqual([
      { type: "error", content: "Relay 当前未连接", threadId: "thread-remote" },
    ]);
    expect(callRemoteAgent).not.toHaveBeenCalled();
  });

  it.each([
    ["hub-1:agent-x", "agent-x"],
    ["hub-1/agent-x", "agent-x"],
    ["hub-1agent-x", "hub-1agent-x"],
  ])(
    "routes %s to the remote agent id %s and relays the reply",
    async (toAgentId, remoteAgentId) => {
      const { bus, callRemoteAgent, handleA2ACall, onRemoteDelivery } = remoteSetup();

      const chunks = await collect(bus.call("caller", toAgentId, "work", context));

      expect(callRemoteAgent).toHaveBeenCalledWith(
        "hub-1",
        "caller",
        remoteAgentId,
        expect.any(String),
        expect.objectContaining({
          callStack: ["caller", toAgentId],
          a2aThreadId: "thread-remote",
        }),
        expect.any(Function),
      );
      expect(chunks).toEqual([
        {
          type: "text",
          content: "remote reply",
          threadId: "thread-remote",
          sourceAgentId: toAgentId,
        },
        { type: "done", content: "", threadId: "thread-remote", sourceAgentId: toAgentId },
      ]);
      expect(onRemoteDelivery).toHaveBeenCalledWith({
        transport: "delivered",
        threadId: "thread-remote",
        conversationId: "conversation-1",
      });
      expect(handleA2ACall).not.toHaveBeenCalled();
    },
  );

  it("prefers the registered remote source id over stripping the hub prefix", async () => {
    const { bus, callRemoteAgent } = remoteSetup({ sourceId: "source-agent" });

    await collect(bus.call("caller", "hub-1:agent-x", "work", context));

    expect(callRemoteAgent).toHaveBeenCalledWith(
      "hub-1",
      "caller",
      "source-agent",
      expect.any(String),
      expect.any(Object),
      expect.any(Function),
    );
  });
});

describe("A2ABus cancellation", () => {
  it("cancels a call and cascades the abort to nested child calls", async () => {
    let deepSignal: AbortSignal | undefined;
    let markDeepStarted!: () => void;
    const deepStarted = new Promise<void>((resolve) => {
      markDeepStarted = resolve;
    });
    const deepAdapter = {
      handleA2ACall: async function* (_from: string, _message: string, ctx: ConversationContext) {
        deepSignal = ctx.signal;
        markDeepStarted();
        await new Promise<never>((_, reject) => {
          ctx.signal?.addEventListener("abort", () => reject(ctx.signal?.reason), { once: true });
        });
      },
    } as A2AAdapter;
    const calleeAdapter = {
      handleA2ACall: async function* (_from: string, _message: string, ctx: ConversationContext) {
        // Deliberately drop ctx.signal so the child can only be aborted through
        // the bus's parent → children cascade.
        yield* bus.call("callee", "deep", "dig", {
          conversationId: ctx.conversationId,
          history: [],
          callStack: ctx.callStack,
        });
      },
    } as A2AAdapter;
    const registry = createRegistry(calleeAdapter, {
      getAdapter: (id) => ({ callee: calleeAdapter, deep: deepAdapter })[id],
    });
    const bus = new A2ABus(registry, defaultOptions);

    const outer = bus
      .call("caller", "callee", "work", {
        conversationId: "conversation-1",
        history: [],
        callStack: ["caller"],
        a2aThreadId: "thread-outer",
      })
      .next();
    const outcome = expect(outer).rejects.toMatchObject({
      name: "AbortError",
      message: "A2A call cancelled",
    });
    await deepStarted;
    expect(deepSignal?.aborted).toBe(false);

    expect(bus.cancel("thread-outer")).toBe(true);

    await outcome;
    expect(deepSignal?.aborted).toBe(true);
    expect(deepSignal?.reason).toMatchObject({ name: "AbortError" });
    // Both the outer and the child entries are released once their generators unwind.
    await vi.waitFor(() => expect(bus.cancel("thread-outer")).toBe(false));
  });

  it("returns false for an unknown thread id", () => {
    const bus = new A2ABus(createRegistry(doneAdapter().adapter), defaultOptions);
    expect(bus.cancel("missing-thread")).toBe(false);
  });
});

describe("A2ABus adapter context", () => {
  it("passes the extended stack, caller name and a summarized history to the adapter", async () => {
    const { adapter, handleA2ACall } = doneAdapter();
    const registry = createRegistry(adapter, {
      get: (id) => ({ id, name: id === "caller" ? "Caller Bot" : id }),
    });
    const bus = new A2ABus(registry, defaultOptions);
    const history = [
      message("user", "u1", "dropped: older than the last five"),
      message("user", "u1", "first   line\n\tsecond line "),
      message("agent", "agent-a", "y".repeat(240)),
      message("agent", "agent-b", "x".repeat(241)),
      message("user", "u1", "short"),
      message("agent", "agent-a", "done"),
    ];

    const chunks = await collect(
      bus.call("caller", "callee", "work", {
        conversationId: "conversation-1",
        history,
        callStack: ["root", "caller"],
        a2aThreadId: "thread-ctx",
      }),
    );

    expect(chunks).toEqual([
      { type: "text", content: "ok", threadId: "thread-ctx", sourceAgentId: "callee" },
      { type: "done", content: "", threadId: "thread-ctx", sourceAgentId: "callee" },
    ]);
    expect(handleA2ACall).toHaveBeenCalledTimes(1);
    expect(handleA2ACall).toHaveBeenCalledWith(
      "caller",
      expect.any(String),
      expect.objectContaining({
        callStack: ["root", "caller", "callee"],
        a2aThreadId: undefined,
        a2aCallerName: "Caller Bot",
        signal: expect.any(AbortSignal),
        a2aContextSummary: [
          "User: first line second line",
          `agent-a: ${"y".repeat(240)}`,
          `agent-b: ${"x".repeat(237)}...`,
          "User: short",
          "agent-a: done",
        ].join("\n"),
      }),
    );
  });

  it("caps the whole context summary at 1200 characters", async () => {
    const { adapter, handleA2ACall } = doneAdapter();
    const bus = new A2ABus(createRegistry(adapter), defaultOptions);
    const history = Array.from({ length: 5 }, () => message("user", "u1", "z".repeat(240)));

    await collect(
      bus.call("caller", "callee", "work", { conversationId: "conversation-1", history }),
    );

    const summary = handleA2ACall.mock.lastCall?.[2].a2aContextSummary;
    const full = Array.from({ length: 5 }, () => `User: ${"z".repeat(240)}`).join("\n");
    expect(full.length).toBeGreaterThan(1_200);
    expect(summary).toHaveLength(1_200);
    expect(summary).toBe(`${full.slice(0, 1_197)}...`);
  });
});

describe("A2ABus call timeout selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fallbackTimeoutMs = 7 * 60_000;

  it.each([
    ["the minimum", MIN_A2A_CALL_TIMEOUT_MS, MIN_A2A_CALL_TIMEOUT_MS],
    ["the maximum", MAX_A2A_CALL_TIMEOUT_MS, MAX_A2A_CALL_TIMEOUT_MS],
    ["below the minimum", MIN_A2A_CALL_TIMEOUT_MS - 1, fallbackTimeoutMs],
    ["above the maximum", MAX_A2A_CALL_TIMEOUT_MS + 1, fallbackTimeoutMs],
    ["a non-integer", MIN_A2A_CALL_TIMEOUT_MS + 0.5, fallbackTimeoutMs],
    ["unset", undefined, fallbackTimeoutMs],
  ])(
    "arms the timer correctly when the per-call timeout is %s",
    async (_label, requested, armed) => {
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const { adapter } = doneAdapter();
      const bus = new A2ABus(createRegistry(adapter), {
        ...defaultOptions,
        callTimeoutMs: fallbackTimeoutMs,
      });

      await collect(
        bus.call("caller", "callee", "work", {
          conversationId: "conversation-1",
          history: [],
          a2aCallTimeoutMs: requested,
        }),
      );

      const delays = setTimeoutSpy.mock.calls.map(([, delay]) => delay);
      expect(delays).toContain(armed);
      expect(delays).not.toContain(armed === fallbackTimeoutMs ? requested : fallbackTimeoutMs);
    },
  );
});
