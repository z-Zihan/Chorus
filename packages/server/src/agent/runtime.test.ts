import type { AppConfig } from "@chorus/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseContext } from "../db";
import { Repository } from "../db/repository";
import { EventHub } from "../ws/events";
import { AgentRegistry } from "./registry";
import { AgentRuntime, DEFAULT_A2A_TASK_TIMEOUT_MS } from "./runtime";

const config: AppConfig = {
  port: 0,
  dbPath: ":memory:",
  cors: { origin: [] },
  auth: { enabled: false, tokens: {} },
  history: { maxMessages: 20, maxTokens: 8_000 },
  agents: [
    { id: "caller", name: "Caller", type: "mock", config: { delayMs: 0 } },
    { id: "callee", name: "Callee", type: "mock", config: { delayMs: 0 } },
  ],
};

describe("AgentRuntime A2A permissions", () => {
  let database: DatabaseContext;
  let repository: Repository;
  let registry: AgentRegistry;
  let runtime: AgentRuntime;
  let events: EventHub;
  let conversationId: string;

  beforeEach(async () => {
    database = createDatabase(":memory:");
    repository = new Repository(database);
    await repository.getOrCreateLocalUser("Test User");
    registry = new AgentRegistry(repository);
    await registry.initialize(config.agents);
    events = new EventHub();
    runtime = new AgentRuntime(repository, registry, events, config);
    conversationId = repository.createConversation("A2A test", "group", ["caller", "callee"]).id;
  });

  afterEach(() => {
    database.sqlite.close();
  });

  it("blocks calls in deny mode", async () => {
    runtime.setA2APermission(conversationId, "deny");

    const result = await runtime.handleRemoteA2ACall("caller", "callee", "check this", {
      conversationId,
      history: [],
      callStack: ["caller"],
    });

    expect(result).toBe("A2A 调用已被禁用");
  });

  it("waits for approval in confirm mode", async () => {
    runtime.setA2APermission(conversationId, "confirm");
    const publish = vi.spyOn(events, "publish");
    const resultPromise = runtime.handleRemoteA2ACall("caller", "callee", "check this", {
      conversationId,
      history: [],
      callStack: ["caller"],
    });

    await vi.waitFor(() => {
      expect(publish).toHaveBeenCalledWith(
        conversationId,
        expect.objectContaining({ type: "a2a_confirmation_required" }),
      );
    });
    const confirmation = publish.mock.calls
      .map((call) => call[1])
      .find((event) => event.type === "a2a_confirmation_required");
    expect(confirmation?.type).toBe("a2a_confirmation_required");
    if (confirmation?.type !== "a2a_confirmation_required") throw new Error("Missing confirmation");

    expect(runtime.confirmA2A(confirmation.threadId, true)).toBe(true);
    await expect(resultPromise).resolves.toContain("已分析任务");
  });

  it("routes an agent output mention as a visible message in the same conversation", async () => {
    const caller = registry.getAdapter("caller");
    const callee = registry.getAdapter("callee");
    if (!caller || !callee) throw new Error("Missing test adapters");

    let callerInput = "";
    let calleeInput = "";
    vi.spyOn(caller, "handleMessage").mockImplementation(async function* (message) {
      callerInput = message;
      yield { type: "text", content: "好的，我来帮你问 Callee。\n" };
      yield { type: "text", content: "@Callee 你好吗" };
      yield { type: "done", content: "" };
    });
    vi.spyOn(callee, "handleMessage").mockImplementation(async function* (message) {
      calleeInput = message;
      yield { type: "text", content: "你好，我是 Callee。" };
      yield { type: "done", content: "" };
    });

    await runtime.handleUserMessage(conversationId, "给 Callee 发一条消息，你好吗", [], "caller");

    expect(callerInput).toContain("You are in a group chat with: [Callee]");
    expect(callerInput).toContain("Never mention an Agent for greetings");
    expect(callerInput).not.toContain("A2A_CALL");
    expect(calleeInput).toContain("[Chorus Agent handoff]");
    expect(calleeInput).toContain("Original objective: 给 Callee 发一条消息，你好吗");
    expect(calleeInput).toContain("Specific request: @Callee 你好吗");
    expect(calleeInput).toContain("Required response quality:");

    const messages = repository.listAllMessages(conversationId);
    expect(messages).toHaveLength(4);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromType: "agent",
          fromId: "caller",
          toType: "agent",
          toId: "callee",
          content: "@Callee 你好吗",
          status: "done",
        }),
        expect.objectContaining({
          fromType: "agent",
          fromId: "callee",
          content: "你好，我是 Callee。",
          status: "done",
        }),
      ]),
    );
  });

  it("stops a reciprocal mention loop at the configured round limit", async () => {
    const caller = registry.getAdapter("caller");
    const callee = registry.getAdapter("callee");
    if (!caller || !callee) throw new Error("Missing test adapters");
    runtime.setA2ACollaborationSettings({ maxRounds: 4 });

    let callerInvocations = 0;
    let calleeInvocations = 0;
    vi.spyOn(caller, "handleMessage").mockImplementation(async function* () {
      callerInvocations += 1;
      yield {
        type: "text",
        content: "Evidence from Caller. @Callee verify the next concrete step.",
      };
      yield { type: "done", content: "" };
    });
    vi.spyOn(callee, "handleMessage").mockImplementation(async function* () {
      calleeInvocations += 1;
      yield {
        type: "text",
        content: "Evidence from Callee. @Caller verify the next concrete step.",
      };
      yield { type: "done", content: "" };
    });

    await runtime.handleUserMessage(conversationId, "Produce a verified result", [], "caller");

    expect(callerInvocations + calleeInvocations).toBe(5);
    expect(callerInvocations).toBe(3);
    expect(calleeInvocations).toBe(2);
    const messages = repository.listAllMessages(conversationId);
    expect(
      messages.filter((message) => message.fromType === "agent" && message.toType === "agent"),
    ).toHaveLength(4);
    expect(messages).toContainEqual(
      expect.objectContaining({
        fromId: "chorus-system",
        content: "[system] Automatic collaboration stopped at the 4-round limit.",
        metadata: expect.objectContaining({
          systemNotice: "a2a_round_limit",
          a2aRound: 4,
          a2aMaxRounds: 4,
        }),
      }),
    );
  });

  it("snapshots the configured per-agent call timeout for a collaboration task", async () => {
    const caller = registry.getAdapter("caller");
    if (!caller) throw new Error("Missing test adapter");
    runtime.setA2ACollaborationSettings({ callTimeoutMinutes: 7 });
    let receivedTimeout: number | undefined;
    vi.spyOn(caller, "handleMessage").mockImplementation(async function* (_message, context) {
      receivedTimeout = context.a2aCallTimeoutMs;
      yield { type: "text", content: "done" };
      yield { type: "done", content: "" };
    });

    await runtime.handleUserMessage(conversationId, "Use the configured timeout", [], "caller");

    expect(receivedTimeout).toBe(7 * 60_000);
  });

  it("stops the full collaboration task at the 20-minute safety limit", async () => {
    vi.useFakeTimers();
    try {
      const caller = registry.getAdapter("caller");
      if (!caller) throw new Error("Missing test adapter");
      vi.spyOn(caller, "handleMessage").mockImplementation(async function* (_message, context) {
        yield { type: "text", content: "work started" };
        await new Promise<never>((_, reject) => {
          const abort = () => reject(context.signal?.reason);
          context.signal?.addEventListener("abort", abort, { once: true });
        });
      });

      const task = runtime.handleUserMessage(conversationId, "Long collaboration", [], "caller");
      await vi.advanceTimersByTimeAsync(DEFAULT_A2A_TASK_TIMEOUT_MS);
      await task;

      expect(repository.listAllMessages(conversationId)).toContainEqual(
        expect.objectContaining({
          fromId: "chorus-system",
          metadata: expect.objectContaining({
            systemNotice: "a2a_task_timeout",
            a2aTaskTimeoutMinutes: 20,
          }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let the task timer preempt a longer valid per-call timeout", async () => {
    vi.useFakeTimers();
    try {
      const caller = registry.getAdapter("caller");
      if (!caller) throw new Error("Missing test adapter");
      runtime.setA2ACollaborationSettings({ callTimeoutMinutes: 30 });
      vi.spyOn(caller, "handleMessage").mockImplementation(async function* (_message, context) {
        await new Promise<never>((_, reject) => {
          const abort = () => reject(context.signal?.reason);
          context.signal?.addEventListener("abort", abort, { once: true });
        });
      });

      const task = runtime.handleUserMessage(conversationId, "Long configured call", [], "caller");
      await vi.advanceTimersByTimeAsync(DEFAULT_A2A_TASK_TIMEOUT_MS);
      expect(
        repository
          .listAllMessages(conversationId)
          .some((message) => message.metadata?.systemNotice === "a2a_task_timeout"),
      ).toBe(false);

      await vi.advanceTimersByTimeAsync(10 * 60_000);
      await task;
      expect(repository.listAllMessages(conversationId)).toContainEqual(
        expect.objectContaining({
          metadata: expect.objectContaining({
            systemNotice: "a2a_task_timeout",
            a2aTaskTimeoutMinutes: 30,
          }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops the entire collaboration when the active reply is cancelled", async () => {
    const caller = registry.getAdapter("caller");
    const callee = registry.getAdapter("callee");
    if (!caller || !callee) throw new Error("Missing test adapters");
    let callerSignal: AbortSignal | undefined;
    let markSignalReady: (() => void) | undefined;
    const signalReady = new Promise<void>((resolve) => {
      markSignalReady = resolve;
    });
    const calleeSpy = vi.spyOn(callee, "handleMessage");
    vi.spyOn(caller, "handleMessage").mockImplementation(async function* (_message, context) {
      callerSignal = context.signal;
      yield { type: "text", content: "work started" };
      await new Promise<never>((_, reject) => {
        const abort = () => reject(context.signal?.reason);
        context.signal?.addEventListener("abort", abort, { once: true });
        markSignalReady?.();
      });
    });

    const task = runtime.handleUserMessage(conversationId, "Stop this collaboration", [], "caller");
    let activeReplyId = "";
    await vi.waitFor(() => {
      const activeReply = repository
        .listAllMessages(conversationId)
        .find((message) => message.fromId === "caller" && message.status === "thinking");
      expect(activeReply).toBeDefined();
      activeReplyId = activeReply?.id ?? "";
    });
    await signalReady;

    runtime.cancel(activeReplyId);
    await task;

    expect(callerSignal?.aborted).toBe(true);
    expect(calleeSpy).not.toHaveBeenCalled();
    expect(repository.listAllMessages(conversationId)).toContainEqual(
      expect.objectContaining({
        id: activeReplyId,
        content: "work started",
        status: "partial",
      }),
    );
  });

  it("preserves a client message ID so optimistic UI state has exact correlation", async () => {
    await runtime.handleUserMessage(
      conversationId,
      "correlated message",
      [],
      "caller",
      "client-message-1",
    );

    expect(repository.listAllMessages(conversationId)).toContainEqual(
      expect.objectContaining({
        id: "client-message-1",
        fromType: "user",
        content: "correlated message",
        status: "done",
      }),
    );
  });
});
