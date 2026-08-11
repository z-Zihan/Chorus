import { randomUUID } from "node:crypto";
import type { ConversationContext, StreamChunk } from "@chorus/shared";
import { BaseAdapter, messageFromError } from "../adapter";
import { buildOpenAIA2APrompt } from "../chorus-skill";

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIStreamResponse {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: { total_tokens?: number };
  error?: { message?: string };
}

interface CompletionRound {
  content: string;
  toolCalls: OpenAIToolCall[];
  tokensUsed?: number;
}

const CALL_AGENT_TOOL = {
  type: "function",
  function: {
    name: "call_agent",
    description:
      "Call another AI agent for assistance. Use this when you need help from a different AI tool.",
    parameters: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "The ID of the agent to call" },
        message: { type: "string", description: "The message to send to the other agent" },
      },
      required: ["agent_id", "message"],
    },
  },
} as const;

const MAX_TOOL_ROUNDS = 8;

export class OpenAIAdapter extends BaseAdapter {
  readonly id: string;
  readonly name: string;
  override readonly description: string;

  constructor(id: string, name: string, description = "OpenAI-compatible agent") {
    super();
    this.id = id;
    this.name = name;
    this.description = description;
  }

  async init(config: Record<string, unknown>): Promise<void> {
    this.config = config;
    const apiKey = String(config.apiKey ?? process.env.OPENAI_API_KEY ?? "");
    if (!apiKey) throw new Error("OpenAI API key is missing");
    this.config = { ...config, apiKey };
    this.status = "online";
  }

  override async healthCheck(): Promise<boolean> {
    const endpoint = String(this.config.endpoint ?? "https://api.openai.com/v1").replace(/\/$/, "");
    try {
      const response = await fetch(`${endpoint}/models`, {
        headers: { Authorization: `Bearer ${String(this.config.apiKey)}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async *handleMessage(message: string, context: ConversationContext): AsyncGenerator<StreamChunk> {
    yield* this.handleWithSystemPrompt(message, context);
  }

  async *handleA2ACall(
    from: string,
    message: string,
    context: ConversationContext,
  ): AsyncGenerator<StreamChunk> {
    const callerName = context.a2aCallerName ?? from;
    const summary = context.a2aContextSummary ?? "No previous context was provided.";
    yield* this.handleWithSystemPrompt(
      message,
      context,
      `You were called by ${callerName}. Previous context:\n${summary}`,
    );
  }

  private async *handleWithSystemPrompt(
    message: string,
    context: ConversationContext,
    a2aSystemPrompt?: string,
  ): AsyncGenerator<StreamChunk> {
    const availableAgentIds = [
      ...new Set(context.availableAgentIds ?? context.mentionedAgents ?? []),
    ];
    const callableAgentIds = availableAgentIds.filter((agentId) => agentId !== this.id);
    const toolsEnabled = availableAgentIds.length > 1 && callableAgentIds.length > 0;
    const directory = toolsEnabled ? buildOpenAIA2APrompt(callableAgentIds) : "";
    const messages: OpenAIMessage[] = [
      {
        role: "system",
        content:
          [String(this.config.systemPrompt ?? "You are a helpful assistant."), a2aSystemPrompt]
            .filter(Boolean)
            .join("\n\n") + directory,
      },
      ...context.history.map((item): OpenAIMessage => ({
        role: item.fromType === "user" ? "user" : "assistant",
        content: item.content,
      })),
      { role: "user", content: message },
    ];

    for (let roundIndex = 0; roundIndex < MAX_TOOL_ROUNDS; roundIndex += 1) {
      const round = yield* this.streamCompletion(messages, context.signal, toolsEnabled);
      if (round.tokensUsed) {
        yield { type: "pipeline", content: "", metadata: { tokensUsed: round.tokensUsed } };
      }
      if (round.toolCalls.length === 0) {
        yield { type: "done", content: "" };
        return;
      }

      messages.push({
        role: "assistant",
        content: round.content || null,
        tool_calls: round.toolCalls,
      });

      for (const toolCall of round.toolCalls) {
        const result = yield* this.executeToolCall(toolCall, callableAgentIds, context);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    }

    throw new Error(`OpenAI exceeded the maximum of ${MAX_TOOL_ROUNDS} tool-calling rounds`);
  }

  private async *streamCompletion(
    messages: OpenAIMessage[],
    signal: AbortSignal | undefined,
    toolsEnabled: boolean,
  ): AsyncGenerator<StreamChunk, CompletionRound> {
    const endpoint = String(this.config.endpoint ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${String(this.config.apiKey)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: String(this.config.model ?? "gpt-4o-mini"),
        stream: true,
        messages,
        ...(toolsEnabled ? { tools: [CALL_AGENT_TOOL] } : {}),
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      const detail = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${detail.slice(0, 240)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const toolCalls = new Map<number, OpenAIToolCall>();
    let content = "";
    let tokensUsed: number | undefined;
    let buffer = "";

    const processLine = function* (line: string): Generator<StreamChunk> {
      if (!line.startsWith("data: ")) return;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") return;
      let data: OpenAIStreamResponse;
      try {
        data = JSON.parse(payload) as OpenAIStreamResponse;
      } catch {
        return;
      }
      if (data.error?.message) throw new Error(data.error.message);
      if (data.usage?.total_tokens) tokensUsed = data.usage.total_tokens;

      const delta = data.choices?.[0]?.delta;
      if (delta?.content) {
        content += delta.content;
        yield { type: "text", content: delta.content };
      }
      for (const part of delta?.tool_calls ?? []) {
        const index = part.index ?? 0;
        const current = toolCalls.get(index) ?? {
          id: "",
          type: "function" as const,
          function: { name: "", arguments: "" },
        };
        if (part.id) current.id += part.id;
        if (part.function?.name) current.function.name += part.function.name;
        if (part.function?.arguments) current.function.arguments += part.function.arguments;
        toolCalls.set(index, current);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) yield* processLine(line.trimEnd());
    }
    buffer += decoder.decode();
    for (const line of buffer.split("\n")) yield* processLine(line.trimEnd());

    return {
      content,
      toolCalls: [...toolCalls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, toolCall], index) => ({
          ...toolCall,
          id: toolCall.id || `call_agent_${index}`,
        })),
      tokensUsed,
    };
  }

  private async *executeToolCall(
    toolCall: OpenAIToolCall,
    callableAgentIds: string[],
    context: ConversationContext,
  ): AsyncGenerator<StreamChunk, string> {
    const threadId = randomUUID();
    let agentId = "";
    let request = "";
    let callStarted = false;

    try {
      if (toolCall.function.name !== "call_agent") {
        throw new Error(`Unsupported tool: ${toolCall.function.name}`);
      }
      const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      agentId = typeof args.agent_id === "string" ? args.agent_id.trim() : "";
      request = typeof args.message === "string" ? args.message.trim() : "";
      if (!agentId || !request) throw new Error("call_agent requires agent_id and message");
      if (!callableAgentIds.includes(agentId)) {
        throw new Error(`Agent ${agentId} is not available in this conversation`);
      }
      if (!context.a2aBus) throw new Error("A2A bus is unavailable");

      callStarted = true;
      yield {
        type: "tool_call",
        content: request,
        threadId,
        sourceAgentId: this.id,
        metadata: { to: agentId, request },
      };

      let result = "";
      let failed = false;
      for await (const chunk of context.a2aBus.call(this.id, agentId, request, {
        ...context,
        a2aThreadId: threadId,
      })) {
        if (chunk.type === "text" || chunk.type === "task_step" || chunk.type === "error") {
          result += chunk.content;
        }
        if (chunk.type === "error") failed = true;
        if (failed && chunk.type === "done") continue;
        yield {
          type: "a2a_response",
          content: chunk.content,
          threadId,
          sourceAgentId: agentId,
          metadata: {
            ...chunk.metadata,
            chunkType: chunk.type,
            status: chunk.type === "done" ? "done" : chunk.type === "error" ? "error" : "streaming",
          },
        };
      }

      const output =
        result || (failed ? "Agent call failed" : "Agent completed without a text response");
      return JSON.stringify({ output, threadId, success: !failed });
    } catch (error) {
      const detail = messageFromError(error);
      if (!callStarted) {
        yield {
          type: "tool_call",
          content: request || detail,
          threadId,
          sourceAgentId: this.id,
          metadata: { to: agentId || "unknown", request: request || detail },
        };
      }
      yield {
        type: "a2a_response",
        content: detail,
        threadId,
        sourceAgentId: agentId || "unknown",
        metadata: { chunkType: "error", status: "error" },
      };
      return JSON.stringify({ output: "", threadId, success: false, error: detail });
    }
  }
}
