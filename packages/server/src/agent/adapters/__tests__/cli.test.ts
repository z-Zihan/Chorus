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

describe("CliAdapter prompt-based A2A", () => {
  it("calls an available agent and feeds its response back to the CLI", async () => {
    const script = [
      "const prompt = process.argv[1] ?? '';",
      "const hasDirectory = prompt.includes('Other available agents: [reviewer]');",
      "const hasResponse = prompt.includes('Responses from the agents you called:') && prompt.includes('No blockers');",
      "process.stdout.write(hasResponse ? 'Review complete' : hasDirectory ? '[A2A_CALL: reviewer: Review this]' : 'Missing A2A prompt');",
    ].join("");
    const call = vi.fn();
    const a2aBus: A2ABusLike = {
      async *call(fromAgentId, toAgentId, message, callContext) {
        call(fromAgentId, toAgentId, message, callContext);
        yield { type: "text", content: "No blockers" };
        yield { type: "done", content: "" };
      },
    };
    const adapter = new CliAdapter("writer", "Writer");
    await adapter.init({
      command: process.execPath,
      args: ["-e", script],
      input: "argument",
      output: "plain",
    });

    const chunks = await collect(adapter.handleMessage("Please review", context({
      availableAgentIds: ["writer", "reviewer"],
      a2aBus,
      callStack: ["writer"],
    })));

    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]?.slice(0, 3)).toEqual(["writer", "reviewer", "Review this"]);
    expect(call.mock.calls[0]?.[3]).toMatchObject({ a2aThreadId: expect.any(String) });
    expect(chunks).toContainEqual(expect.objectContaining({
      type: "tool_call",
      content: "Review this",
      metadata: { to: "reviewer", request: "Review this" },
    }));
    expect(chunks).toContainEqual(expect.objectContaining({
      type: "a2a_response",
      content: "No blockers",
      sourceAgentId: "reviewer",
    }));
    expect(chunks.filter((chunk) => chunk.type === "text").map((chunk) => chunk.content).join(""))
      .toBe("Review complete\n");
    expect(chunks.at(-1)).toEqual({ type: "done", content: "" });
  });

  it("does not inject A2A instructions when prompt-based A2A is disabled", async () => {
    const adapter = new CliAdapter("writer", "Writer");
    await adapter.init({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.argv[1] ?? '')"],
      input: "argument",
      output: "plain",
      a2aEnabled: false,
    });

    const chunks = await collect(adapter.handleMessage("Original prompt", context({
      availableAgentIds: ["writer", "reviewer"],
    })));

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

    const chunks = await collect(adapter.handleMessage("Original prompt", context({
      availableAgentIds: ["writer"],
    })));

    expect(chunks).toEqual([
      { type: "text", content: "Original prompt\n" },
      { type: "done", content: "" },
    ]);
  });
});
