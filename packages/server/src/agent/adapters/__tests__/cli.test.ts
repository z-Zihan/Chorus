import type { A2ABusLike, ConversationContext, StreamChunk } from "@agentlink/shared";
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
  it("processes a group message once without interpreting A2A_CALL output", async () => {
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
