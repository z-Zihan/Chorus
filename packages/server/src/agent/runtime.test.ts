import type { AppConfig } from "@agentlink/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseContext } from "../db";
import { Repository } from "../db/repository";
import { EventHub } from "../ws/events";
import { AgentRegistry } from "./registry";
import { AgentRuntime } from "./runtime";

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

    expect(callerInput).toContain(
      "You are in a group chat with: [Callee]. If you want to ask another agent something, mention them with @AgentName in your response.",
    );
    expect(callerInput).not.toContain("A2A_CALL");
    expect(calleeInput).toContain("@Callee 你好吗");

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
});
