import type { ConversationContext, StreamChunk } from "@agentlink/shared";
import { BaseAdapter } from "../adapter";

interface OpenAIStreamResponse {
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: { total_tokens?: number };
  error?: { message?: string };
}

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

  async *handleMessage(message: string, context: ConversationContext): AsyncGenerator<StreamChunk> {
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
        messages: [
          { role: "system", content: String(this.config.systemPrompt ?? "You are a helpful assistant.") },
          ...context.history.map((item) => ({
            role: item.fromType === "user" ? "user" : "assistant",
            content: item.content,
          })),
          { role: "user", content: message },
        ],
      }),
      signal: context.signal,
    });

    if (!response.ok || !response.body) {
      const detail = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${detail.slice(0, 240)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "[DONE]") continue;
        const data = JSON.parse(payload) as OpenAIStreamResponse;
        if (data.error?.message) throw new Error(data.error.message);
        const content = data.choices?.[0]?.delta?.content;
        if (content) yield { type: "text", content };
        if (data.usage?.total_tokens) {
          yield { type: "pipeline", content: "", metadata: { tokensUsed: data.usage.total_tokens } };
        }
      }
    }
    yield { type: "done", content: "" };
  }
}
