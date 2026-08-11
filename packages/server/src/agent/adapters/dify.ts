import type { ConversationContext, StreamChunk } from "@chorus/shared";
import { BaseAdapter } from "../adapter";

export interface DifyAdapterConfig {
  apiKey: string;
  apiUrl: string;
  conversationId?: string;
}

interface DifyEvent {
  event?: string;
  answer?: string;
  message?: string;
  conversation_id?: string;
  code?: string;
}

export class DifyAdapter extends BaseAdapter {
  readonly id: string;
  readonly name: string;
  override readonly description: string;
  private readonly conversations = new Map<string, string>();

  constructor(id: string, name: string, description = "Dify Chat agent") {
    super();
    this.id = id;
    this.name = name;
    this.description = description;
  }

  async init(config: Record<string, unknown>): Promise<void> {
    const apiKey = typeof config.apiKey === "string" ? config.apiKey.trim() : "";
    if (!apiKey) throw new Error("Dify API key is missing");
    this.config = {
      apiKey,
      apiUrl: String(config.apiUrl ?? "https://api.dify.ai").replace(/\/$/u, ""),
      conversationId: typeof config.conversationId === "string" ? config.conversationId : undefined,
    } satisfies DifyAdapterConfig;
    this.status = "online";
  }

  async *handleMessage(message: string, context: ConversationContext): AsyncGenerator<StreamChunk> {
    const config = this.config as unknown as DifyAdapterConfig;
    const conversationId = this.conversations.get(context.conversationId)
      ?? context.difyConversationId
      ?? config.conversationId;
    const response = await fetch(`${config.apiUrl}/v1/chat-messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        inputs: {},
        query: message,
        response_mode: "streaming",
        user: context.conversationId,
        ...(conversationId ? { conversation_id: conversationId } : {}),
      }),
      signal: context.signal,
    });
    if (!response.ok || !response.body) {
      const detail = await response.text();
      throw new Error(`Dify request failed (${response.status}): ${detail.slice(0, 240)}`);
    }

    yield* this.streamResponse(response.body, context.conversationId);
    yield { type: "done", content: "" };
  }

  private async *streamResponse(
    body: ReadableStream<Uint8Array>,
    localConversationId: string,
  ): AsyncGenerator<StreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const processLine = (line: string): StreamChunk | null => {
      if (!line.startsWith("data:")) return null;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") return null;
      let event: DifyEvent;
      try {
        event = JSON.parse(raw) as DifyEvent;
      } catch {
        return null;
      }
      if (event.conversation_id) {
        this.conversations.set(localConversationId, event.conversation_id);
      }
      if (event.event === "error") {
        throw new Error(event.message ?? event.code ?? "Dify stream failed");
      }
      return event.answer ? { type: "text", content: event.answer } : null;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const chunk = processLine(line);
        if (chunk) yield chunk;
      }
    }
    buffer += decoder.decode();
    for (const line of buffer.split(/\r?\n/u)) {
      const chunk = processLine(line);
      if (chunk) yield chunk;
    }
  }
}
