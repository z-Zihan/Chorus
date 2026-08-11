import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ConversationContext, StreamChunk } from "@chorus/shared";
import { BaseAdapter } from "../adapter.js";

export interface LangChainAdapterConfig {
  runnableScript?: string;
  endpoint?: string;
  model?: string;
  apiKey?: string;
}

interface RunnableLike {
  invoke?(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  stream?(input: unknown, options?: { signal?: AbortSignal }): AsyncIterable<unknown>;
}

export class LangChainAdapter extends BaseAdapter {
  readonly id: string;
  readonly name: string;
  override readonly description: string;
  private runnable?: RunnableLike;

  constructor(id: string, name: string, description = "LangChain Runnable agent") {
    super();
    this.id = id;
    this.name = name;
    this.description = description;
  }

  async init(config: Record<string, unknown>): Promise<void> {
    const endpoint = typeof config.endpoint === "string" ? config.endpoint.trim() : "";
    const runnableScript = typeof config.runnableScript === "string"
      ? config.runnableScript.trim()
      : "";
    if (!endpoint && !runnableScript) {
      throw new Error("LangChain adapter requires endpoint or runnableScript");
    }
    this.config = {
      endpoint: endpoint || undefined,
      runnableScript: runnableScript || undefined,
      model: typeof config.model === "string" ? config.model : undefined,
      apiKey: typeof config.apiKey === "string" ? config.apiKey : undefined,
    } satisfies LangChainAdapterConfig;
    this.status = "online";
  }

  async *handleMessage(message: string, context: ConversationContext): AsyncGenerator<StreamChunk> {
    const config = this.config as unknown as LangChainAdapterConfig;
    const input = {
      message,
      history: context.history,
      model: config.model,
    };
    if (config.endpoint) {
      yield* this.streamEndpoint(config, input, context.signal);
    } else if (config.runnableScript) {
      yield* this.streamRunnable(config.runnableScript, input, context.signal);
    } else {
      throw new Error("LangChain adapter is missing endpoint and runnableScript configuration");
    }
    yield { type: "done", content: "" };
  }

  private async *streamEndpoint(
    config: LangChainAdapterConfig,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const endpoint = config.endpoint;
    if (!endpoint) throw new Error("LangChain endpoint is not configured");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream, application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ input, config: { configurable: { model: config.model } } }),
      signal,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`LangChain request failed (${response.status}): ${detail.slice(0, 240)}`);
    }
    if (!response.body) throw new Error("LangChain endpoint returned an empty response");

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      yield* parseLangChainSse(response.body);
      return;
    }
    const payload = await response.json() as unknown;
    const content = outputText(payload);
    if (content) yield { type: "text", content };
  }

  private async *streamRunnable(
    runnableScript: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    if (!this.runnable) {
      const scriptUrl = runnableScript.startsWith("file:")
        ? runnableScript
        : pathToFileURL(isAbsolute(runnableScript) ? runnableScript : resolve(runnableScript)).href;
      // TODO: Replace this structural loader with the official LangChain Runnable loader when
      // Chorus adopts LangChain as an optional dependency.
      const module = await import(scriptUrl) as Record<string, unknown>;
      const candidate = module.default ?? module.runnable;
      this.runnable = typeof candidate === "function"
        ? await (candidate as () => RunnableLike | Promise<RunnableLike>)()
        : candidate as RunnableLike;
    }
    if (this.runnable.stream) {
      for await (const value of this.runnable.stream(input, { signal })) {
        const content = outputText(value);
        if (content) yield { type: "text", content };
      }
      return;
    }
    if (!this.runnable.invoke) throw new Error("LangChain script does not export a Runnable");
    const content = outputText(await this.runnable.invoke(input, { signal }));
    if (content) yield { type: "text", content };
  }
}

async function* parseLangChainSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const parseLine = (line: string): StreamChunk | undefined => {
    if (!line.startsWith("data:")) return undefined;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") return undefined;
    let value: unknown = raw;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      // SSE data may be plain text.
    }
    const content = outputText(value);
    return content ? { type: "text", content } : undefined;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const chunk = parseLine(line);
      if (chunk) yield chunk;
    }
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/u)) {
    const chunk = parseLine(line);
    if (chunk) yield chunk;
  }
}

function outputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["content", "output", "text", "answer", "delta"]) {
    if (key in record) {
      const selected = outputText(record[key]);
      if (selected) return selected;
    }
  }
  return "";
}
