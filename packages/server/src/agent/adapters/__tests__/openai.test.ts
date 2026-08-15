import type { A2ABusLike, ConversationContext, StreamChunk } from "@chorus/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIAdapter } from "../openai";

function streamResponse(events: unknown[]): Response {
  const body = events
    .map((event) =>
      event === "[DONE]" ? "data: [DONE]\n\n" : `data: ${JSON.stringify(event)}\n\n`,
    )
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function context(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    conversationId: "conversation-1",
    history: [],
    mentionedAgents: [],
    ...overrides,
  };
}

async function collect(stream: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe("OpenAIAdapter tool calling", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls an A2A agent, streams its response, and sends the result back to the LLM", async () => {
    const requests: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (requests.length === 1) {
        return streamResponse([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: "call_agent", arguments: '{"agent_id":"reviewer",' },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: '"message":"Review this"}' } }],
                },
              },
            ],
          },
          "[DONE]",
        ]);
      }
      return streamResponse([{ choices: [{ delta: { content: "Review complete" } }] }, "[DONE]"]);
    });
    vi.stubGlobal("fetch", fetchMock);

    let busThreadId = "";
    const a2aBus: A2ABusLike = {
      async *call(_from, _to, _message, callContext) {
        busThreadId = callContext.a2aThreadId ?? "";
        yield { type: "text", content: "No blockers" };
        yield { type: "done", content: "" };
      },
    };
    const adapter = new OpenAIAdapter("writer", "Writer");
    await adapter.init({ apiKey: "test-key", model: "test-model" });

    const chunks = await collect(
      adapter.handleMessage(
        "Please review",
        context({
          availableAgentIds: ["writer", "reviewer"],
          a2aBus,
          callStack: ["writer"],
          maxA2ARounds: 1,
        }),
      ),
    );

    const toolCall = chunks.find((chunk) => chunk.type === "tool_call");
    expect(toolCall?.metadata).toMatchObject({ to: "reviewer", request: "Review this" });
    expect(toolCall?.threadId).toBeTruthy();
    expect(busThreadId).toBe(toolCall?.threadId);
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "a2a_response",
        content: "No blockers",
        sourceAgentId: "reviewer",
      }),
    );
    expect(chunks).toContainEqual({ type: "text", content: "Review complete" });
    expect(chunks.at(-1)).toEqual({ type: "done", content: "" });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ function: expect.objectContaining({ name: "call_agent" }) }),
      ]),
    );
    const continuationMessages = requests[1]?.messages as Array<Record<string, unknown>>;
    const toolResult = continuationMessages.find((message) => message.role === "tool");
    expect(JSON.parse(String(toolResult?.content))).toMatchObject({
      output: "No blockers",
      success: true,
      threadId: toolCall?.threadId,
    });
  });

  it("does not inject tools into a single-agent conversation", async () => {
    let request: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        request = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return streamResponse([{ choices: [{ delta: { content: "Hello" } }] }, "[DONE]"]);
      }),
    );
    const adapter = new OpenAIAdapter("solo", "Solo");
    await adapter.init({ apiKey: "test-key" });

    expect(
      await collect(
        adapter.handleMessage(
          "Hi",
          context({
            availableAgentIds: ["solo"],
          }),
        ),
      ),
    ).toEqual([
      { type: "text", content: "Hello" },
      { type: "done", content: "" },
    ]);
    expect(request).not.toHaveProperty("tools");
  });

  it("counts A2A handoffs independently from model completion rounds", async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "call_agent",
                      arguments: '{"agent_id":"reviewer","message":"Review this"}',
                    },
                  },
                ],
              },
            },
          ],
        },
        "[DONE]",
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const call = vi.fn();
    const a2aBus: A2ABusLike = {
      async *call() {
        call();
        yield { type: "text", content: "Evidence" };
        yield { type: "done", content: "" };
      },
    };
    const adapter = new OpenAIAdapter("writer", "Writer");
    await adapter.init({ apiKey: "test-key" });

    await expect(
      collect(
        adapter.handleMessage(
          "Please review",
          context({
            availableAgentIds: ["writer", "reviewer"],
            a2aBus,
            maxA2ARounds: 2,
          }),
        ),
      ),
    ).rejects.toThrow("maximum of 2 A2A handoffs");
    expect(call).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
