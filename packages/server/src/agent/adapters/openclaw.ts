import type { ConversationContext, StreamChunk } from "@agentlink/shared";
import { BaseAdapter } from "../adapter";

export interface OpenClawAdapterConfig {
  serverUrl: string;
  sessionKey?: string;
  workspace?: string;
}

export class OpenClawAdapter extends BaseAdapter {
  readonly id: string;
  readonly name: string;
  override readonly description: string;

  constructor(id: string, name: string, description = "OpenClaw agent") {
    super();
    this.id = id;
    this.name = name;
    this.description = description;
  }

  async init(config: Record<string, unknown>): Promise<void> {
    const serverUrl = typeof config.serverUrl === "string" ? config.serverUrl.trim() : "";
    if (!serverUrl) throw new Error("OpenClaw serverUrl is missing");
    this.config = {
      serverUrl: serverUrl.replace(/\/$/u, ""),
      sessionKey: typeof config.sessionKey === "string" ? config.sessionKey : undefined,
      workspace: typeof config.workspace === "string" ? config.workspace : undefined,
    } satisfies OpenClawAdapterConfig;
    this.status = "online";
  }

  async *handleMessage(message: string, context: ConversationContext): AsyncGenerator<StreamChunk> {
    const config = this.config as unknown as OpenClawAdapterConfig;
    // TODO: Align this request with the finalized OpenClaw session API contract.
    const sessionPath = config.sessionKey
      ? `/api/sessions/${encodeURIComponent(config.sessionKey)}/messages`
      : "/api/sessions/messages";
    const response = await fetch(`${config.serverUrl}${sessionPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ message, workspace: config.workspace, stream: true }),
      signal: context.signal,
    });
    if (!response.ok || !response.body) {
      const detail = await response.text();
      throw new Error(`OpenClaw request failed (${response.status}): ${detail.slice(0, 240)}`);
    }

    yield* streamOpenClaw(response.body);
    yield { type: "done", content: "" };
  }
}

async function* streamOpenClaw(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processLine = (line: string): StreamChunk | null => {
    if (!line.startsWith("data:")) return null;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") return null;
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const content = data.content ?? data.text ?? data.message ?? data.delta;
      return typeof content === "string" && content ? { type: "text", content } : null;
    } catch {
      return { type: "text", content: raw };
    }
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
