import type { ConversationContext, Message, StreamChunk } from "@chorus/shared";
import { BaseAdapter } from "../adapter";

export interface CustomAdapterConfig {
  endpoint: string;
  headers?: Record<string, string>;
  bodyTemplate: string;
  responsePath: string;
  streamPath?: string;
  systemPrompt?: string;
}

const TEMPLATE_KEYS = ["message", "history", "systemPrompt"] as const;

export class CustomAdapter extends BaseAdapter {
  readonly id: string;
  readonly name: string;
  override readonly description: string;

  constructor(id: string, name: string, description = "Custom HTTP agent") {
    super();
    this.id = id;
    this.name = name;
    this.description = description;
  }

  async init(config: Record<string, unknown>): Promise<void> {
    const endpoint = typeof config.endpoint === "string" ? config.endpoint.trim() : "";
    const bodyTemplate = typeof config.bodyTemplate === "string" ? config.bodyTemplate : "";
    const responsePath = typeof config.responsePath === "string" ? config.responsePath.trim() : "";
    if (!endpoint) throw new Error("Custom adapter endpoint is missing");
    if (!bodyTemplate) throw new Error("Custom adapter bodyTemplate is missing");
    if (!responsePath) throw new Error("Custom adapter responsePath is missing");
    this.config = {
      endpoint,
      headers: stringRecord(config.headers),
      bodyTemplate,
      responsePath,
      streamPath: typeof config.streamPath === "string" ? config.streamPath.trim() : undefined,
      systemPrompt: typeof config.systemPrompt === "string" ? config.systemPrompt : "",
    } satisfies CustomAdapterConfig;
    this.status = "online";
  }

  override async healthCheck(): Promise<boolean> {
    const config = this.config as unknown as CustomAdapterConfig;
    try {
      const response = await fetch(config.endpoint, {
        method: "HEAD",
        headers: config.headers,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async *handleMessage(message: string, context: ConversationContext): AsyncGenerator<StreamChunk> {
    const config = this.config as unknown as CustomAdapterConfig;
    const body = renderBody(config.bodyTemplate, {
      message,
      history: context.history,
      systemPrompt: config.systemPrompt ?? "",
    });
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: config.streamPath ? "text/event-stream" : "application/json",
        ...config.headers,
      },
      body,
      signal: context.signal,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Custom API request failed (${response.status}): ${detail.slice(0, 240)}`);
    }

    if (config.streamPath) {
      if (!response.body) throw new Error("Custom API returned an empty stream");
      yield* streamSse(response.body, config.streamPath);
    } else {
      const payload = await parseResponse(response);
      const content = pathString(payload, config.responsePath);
      if (content) yield { type: "text", content };
    }
    yield { type: "done", content: "" };
  }
}

function renderBody(
  template: string,
  values: { message: string; history: Message[]; systemPrompt: string },
): string {
  let rendered = template;
  for (const key of TEMPLATE_KEYS) {
    const value = key === "history" ? values.history : values[key];
    rendered = rendered.replaceAll(`"{{${key}}}"`, JSON.stringify(value));
    rendered = rendered.replaceAll(`{{${key}}}`, JSON.stringify(value));
  }
  return rendered;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function* streamSse(
  body: ReadableStream<Uint8Array>,
  streamPath: string,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processLine = (line: string): StreamChunk | null => {
    if (!line.startsWith("data:")) return null;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return null;
    let payload: unknown = data;
    try {
      payload = JSON.parse(data) as unknown;
    } catch {
      // Plain-text SSE data is valid and can be selected with an empty/root path.
    }
    const content = pathString(payload, streamPath);
    return content ? { type: "text", content } : null;
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

function pathString(value: unknown, path: string): string {
  const selected = getPath(value, path);
  if (typeof selected === "string") return selected;
  if (typeof selected === "number" || typeof selected === "boolean") return String(selected);
  return selected === null || selected === undefined ? "" : JSON.stringify(selected);
}

function getPath(value: unknown, path: string): unknown {
  const normalized = path
    .trim()
    .replace(/^\$\.?/u, "")
    .replace(/\[(\d+)\]/gu, ".$1");
  if (!normalized) return value;
  return normalized
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((current, key) => {
      if (current === null || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[key];
    }, value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}
