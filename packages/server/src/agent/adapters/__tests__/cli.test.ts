import type { A2ABusLike, ConversationContext, StreamChunk } from "@chorus/shared";
import { describe, expect, it, vi } from "vitest";
import { CliAdapter } from "../cli";

function context(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    conversationId: "conversation-1",
    history: [],
    ...overrides,
  };
}

async function collect(stream: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe("CliAdapter", () => {
  it("keeps A2A_CALL output visible in mention mode", async () => {
    const call = vi.fn();
    const a2aBus: A2ABusLike = {
      async *call(fromAgentId, toAgentId, message, callContext) {
        call(fromAgentId, toAgentId, message, callContext);
        yield { type: "done" as const, content: "" };
      },
    };
    const adapter = new CliAdapter("writer", "Writer");
    await adapter.init({
      command: process.execPath,
      args: ["-e", "process.stdout.write('[A2A_CALL: reviewer: Review this]')"],
      input: "argument",
      output: "plain",
    });

    const chunks = await collect(
      adapter.handleMessage(
        "Please review",
        context({
          a2aMode: "mention",
          availableAgentIds: ["writer", "reviewer"],
          a2aBus,
          callStack: ["writer"],
        }),
      ),
    );

    expect(call).not.toHaveBeenCalled();
    expect(chunks).toEqual([
      { type: "text", content: "[A2A_CALL: reviewer: Review this]\n" },
      { type: "done", content: "" },
    ]);
  });

  it("parses and executes A2A_CALL output in call mode", async () => {
    const call = vi.fn();
    const a2aBus: A2ABusLike = {
      async *call(fromAgentId, toAgentId, message, callContext) {
        call(fromAgentId, toAgentId, message, callContext);
        yield { type: "text" as const, content: "Looks good" };
        yield { type: "done" as const, content: "" };
      },
    };
    const adapter = new CliAdapter("writer", "Writer");
    await adapter.init({
      command: process.execPath,
      args: [
        "-e",
        "const p=process.argv[1]??'';process.stdout.write(p.includes('Responses from the agents you called:')?'Final answer':'[A2A_CALL: reviewer: Review this]')",
      ],
      input: "argument",
      output: "plain",
    });

    const chunks = await collect(
      adapter.handleMessage(
        "Please review",
        context({
          a2aMode: "call",
          availableAgentIds: ["writer", "reviewer"],
          a2aBus,
          callStack: ["writer"],
        }),
      ),
    );

    expect(call).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledWith(
      "writer",
      "reviewer",
      "Review this",
      expect.objectContaining({ a2aMode: "call", a2aThreadId: expect.any(String) }),
    );
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "tool_call",
      "a2a_response",
      "a2a_response",
      "text",
      "done",
    ]);
    expect(chunks[0]).toMatchObject({
      type: "tool_call",
      content: "Review this",
      sourceAgentId: "writer",
      metadata: { to: "reviewer", request: "Review this" },
    });
    expect(chunks[1]).toMatchObject({
      type: "a2a_response",
      content: "Looks good",
      sourceAgentId: "reviewer",
    });
    expect(chunks[3]).toEqual({ type: "text", content: "Final answer\n" });
  });

  it("does not interpret A2A_CALL output in off mode", async () => {
    const call = vi.fn();
    const a2aBus: A2ABusLike = {
      async *call() {
        call();
        yield { type: "done" as const, content: "" };
      },
    };
    const adapter = new CliAdapter("writer", "Writer");
    await adapter.init({
      command: process.execPath,
      args: ["-e", "process.stdout.write('[A2A_CALL: reviewer: Review this]')"],
      input: "argument",
      output: "plain",
    });

    const chunks = await collect(
      adapter.handleMessage(
        "Please review",
        context({
          a2aMode: "off",
          availableAgentIds: ["writer", "reviewer"],
          a2aBus,
        }),
      ),
    );

    expect(call).not.toHaveBeenCalled();
    expect(chunks).toEqual([
      { type: "text", content: "[A2A_CALL: reviewer: Review this]\n" },
      { type: "done", content: "" },
    ]);
  });

  it("passes the message through unchanged when A2A is disabled", async () => {
    const adapter = new CliAdapter("writer", "Writer");
    await adapter.init({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.argv[1] ?? '')"],
      input: "argument",
      output: "plain",
      a2aEnabled: false,
    });

    const chunks = await collect(
      adapter.handleMessage(
        "Original prompt",
        context({
          availableAgentIds: ["writer", "reviewer"],
        }),
      ),
    );

    expect(chunks).toEqual([
      { type: "text", content: "Original prompt\n" },
      { type: "done", content: "" },
    ]);
  });

  it("does not inject A2A instructions when no other agent is available", async () => {
    const adapter = new CliAdapter("writer", "Writer");
    await adapter.init({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.argv[1] ?? '')"],
      input: "argument",
      output: "plain",
    });

    const chunks = await collect(
      adapter.handleMessage(
        "Original prompt",
        context({
          availableAgentIds: ["writer"],
        }),
      ),
    );

    expect(chunks).toEqual([
      { type: "text", content: "Original prompt\n" },
      { type: "done", content: "" },
    ]);
  });
});
