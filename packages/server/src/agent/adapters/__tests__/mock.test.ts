import type { ConversationContext, StreamChunk } from "@agentlink/shared";
import { describe, expect, it } from "vitest";
import { MockAdapter } from "../mock";

function context(signal?: AbortSignal): ConversationContext {
  return {
    conversationId: "conversation-1",
    history: [],
    signal,
  };
}

async function collect(chunks: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const result: StreamChunk[] = [];
  for await (const chunk of chunks) result.push(chunk);
  return result;
}

describe("MockAdapter", () => {
  it("streams output in multiple chunks", async () => {
    const adapter = new MockAdapter("mock", "Mock");
    await adapter.init({ delayMs: 0 });

    const chunks = await collect(adapter.handleMessage("hello", context()));

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]).toMatchObject({ type: "thinking" });
    expect(chunks.some((chunk) => chunk.type === "text")).toBe(true);
    expect(chunks.at(-1)).toEqual({ type: "done", content: "" });
  });

  it("stops generation when the cancel signal is aborted", async () => {
    const adapter = new MockAdapter("mock", "Mock");
    await adapter.init({ delayMs: 20 });
    const controller = new AbortController();
    const chunks = adapter.handleMessage("hello", context(controller.signal));

    await expect(chunks.next()).resolves.toMatchObject({ value: { type: "thinking" } });
    const pendingChunk = chunks.next();
    controller.abort();

    await expect(pendingChunk).rejects.toMatchObject({ name: "AbortError" });
  });

  it("generates an A2A response with source and conversation context", async () => {
    const adapter = new MockAdapter("mock", "Mock");
    await adapter.init({ delayMs: 0 });

    const chunks = await collect(
      adapter.handleA2ACall("reviewer", "check this change", context()),
    );

    expect(chunks).toEqual([
      { type: "thinking", content: "正在处理来自 reviewer 的请求" },
      { type: "text", content: "已分析任务：check this change。未发现阻塞项。" },
      { type: "done", content: "", metadata: { context: "conversation-1" } },
    ]);
  });
});
