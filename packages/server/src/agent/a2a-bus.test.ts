import type { AgentAdapter, ConversationContext } from "@chorus/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { A2ABus } from "./a2a-bus";
import type { AgentRegistry } from "./registry";

function createRegistry(adapter: Pick<AgentAdapter, "handleA2ACall">): AgentRegistry {
  return {
    get: (id: string) => ({ id, name: id }),
    getAdapter: (id: string) => (id === "callee" ? adapter : undefined),
    getStatus: () => "online",
    getRemoteAgentHub: () => undefined,
  } as unknown as AgentRegistry;
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
