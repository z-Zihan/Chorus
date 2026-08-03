import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, resolve } from "node:path";
import type { ConversationContext, StreamChunk } from "@agentlink/shared";
import { BaseAdapter } from "../adapter";

type CliInputMode = "stdin" | "argument";
type CliOutputMode = "jsonl" | "codex-json" | "plain" | "json";

export interface CliAdapterConfig {
  command: string;
  args?: string[];
  input?: CliInputMode;
  output?: CliOutputMode;
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
}

interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  error?: Error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getStringRecordValue(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function collectJsonText(value: unknown, depth = 0): string[] {
  if (depth > 5 || value === null || value === undefined) return [];
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (typeof value === "number" || typeof value === "boolean") return [];
  if (Array.isArray(value)) return value.flatMap((item) => collectJsonText(item, depth + 1));
  if (!isRecord(value)) return [];

  const recordType = getStringRecordValue(value, ["type"]);
  if (recordType === "system" || recordType === "user") return [];

  const messageText = collectMessageContentText(value.message);
  if (messageText.length) return messageText;

  const resultText = collectJsonText(value.result, depth + 1);
  if (resultText.length) return resultText;

  const directText = getStringRecordValue(value, [
    "message", "response", "text", "delta", "content", "summary",
    "title", "command", "cmd", "error", "status",
  ]);
  if (directText) return [directText];

  return [
    "message", "response", "delta", "content", "item", "event",
    "tool_call", "toolCall", "result", "data",
  ].flatMap((key) => collectJsonText(value[key], depth + 1)).filter(Boolean);
}

function collectMessageContentText(message: unknown): string[] {
  if (!isRecord(message)) return collectJsonText(message);
  const content = message.content;
  if (typeof content === "string") return content.trim() ? [content.trim()] : [];
  if (!Array.isArray(content)) return collectJsonText(content);
  return content
    .flatMap((item) => {
      if (typeof item === "string") return item.trim() ? [item.trim()] : [];
      if (!isRecord(item)) return collectJsonText(item);
      const itemType = getStringRecordValue(item, ["type"]);
      if (itemType === "text") {
        const text = getStringRecordValue(item, ["text"]);
        return text ? [text] : [];
      }
      if (itemType === "tool_use") {
        const name = getStringRecordValue(item, ["name"]);
        return name ? [`[tool] ${name}`] : [];
      }
      if (itemType === "tool_result") return collectJsonText(item.content);
      return collectJsonText(item);
    })
    .filter(Boolean);
}

function formatJsonLine(rawEvent: unknown): string | null {
  if (!isRecord(rawEvent)) return JSON.stringify(rawEvent);

  const eventType = getStringRecordValue(rawEvent, ["type", "event", "kind", "sessionUpdate"]);

  // Claude Code stream-json: init/config metadata and echoes of user input.
  if (eventType === "system" || eventType === "user") return null;

  if (eventType === "assistant") {
    const message = rawEvent.message;
    if (!isRecord(message)) return null;
    const content = message.content;
    if (typeof content === "string") return content.trim() || null;
    if (!Array.isArray(content)) return null;
    const text = content
      .filter((item): item is Record<string, unknown> => isRecord(item) && item.type === "text")
      .map((item) => (typeof item.text === "string" ? item.text : ""))
      .join("")
      .trim();
    return text || null;
  }

  if (eventType === "result") {
    const result = rawEvent.result;
    const text = typeof result === "string"
      ? result.trim()
      : collectJsonText(result).join("").trim();
    return text || null;
  }

  const text = collectJsonText(rawEvent)
    .filter((part) => part !== eventType)
    .join("")
    .trim();
  if (!text) return null;

  if (/chunk|delta|partial/iu.test(eventType)) return text;
  return eventType ? `[${eventType}] ${text}` : text;
}

function parseCodexJson(raw: unknown): string {
  if (!isRecord(raw)) return String(raw);
  const message = raw.message;
  if (typeof message === "string") return message;
  if (isRecord(message)) {
    const content = message.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === "string") return item;
          if (isRecord(item) && item.type === "text" && typeof item.text === "string") return item.text;
          if (isRecord(item) && item.type === "tool_use") return `[tool] ${getStringRecordValue(item, ["name"])}`;
          return "";
        })
        .filter(Boolean)
        .join("");
    }
  }
  return JSON.stringify(raw);
}

export class CliAdapter extends BaseAdapter {
  readonly id: string;
  readonly name: string;
  override readonly description: string;
  private child: ChildProcess | null = null;

  constructor(id: string, name: string, description = "CLI Agent") {
    super();
    this.id = id;
    this.name = name;
    this.description = description;
  }

  async init(config: Record<string, unknown>): Promise<void> {
    const cfg = config as unknown as Partial<CliAdapterConfig>;
    this.config = {
      command: String(cfg.command ?? "claude"),
      args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
      input: (cfg.input as CliInputMode) ?? "argument",
      output: (cfg.output as CliOutputMode) ?? "jsonl",
      env: (cfg.env as Record<string, string>) ?? undefined,
      cwd: typeof cfg.cwd === "string" ? cfg.cwd : undefined,
      timeout: Number.isFinite(Number(cfg.timeout))
        ? Math.max(1, Number(cfg.timeout))
        : 300_000,
    } satisfies CliAdapterConfig;
    this.status = "online";
  }

  override async healthCheck(): Promise<boolean> {
    const config = this.config as unknown as CliAdapterConfig;
    const executable = config.command;
    const environment = { ...process.env, ...config.env };
    const candidates = executable.includes("/") || executable.includes("\\")
      ? [isAbsolute(executable) ? executable : resolve(config.cwd ?? process.cwd(), executable)]
      : (environment.PATH ?? "").split(delimiter).filter(Boolean).flatMap((directory) => {
          if (process.platform !== "win32") return [resolve(directory, executable)];
          const extensions = executable.includes(".")
            ? [""]
            : (environment.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";");
          return extensions.map((extension) => resolve(directory, `${executable}${extension}`));
        });
    for (const candidate of candidates) {
      try {
        await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return true;
      } catch {
        // Try the next PATH entry.
      }
    }
    return false;
  }

  async *handleMessage(message: string, context: ConversationContext): AsyncGenerator<StreamChunk> {
    const cfg = this.config as unknown as CliAdapterConfig;
    const isArgumentMode = (cfg.input ?? "argument") === "argument";
    const args = cfg.args ?? [];
    const spawnArgs = isArgumentMode ? [...args, message] : [...args];

    const child = spawn(cfg.command, spawnArgs, {
      cwd: cfg.cwd ?? process.cwd(),
      env: cfg.env ? { ...process.env, ...cfg.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    this.child = child;
    let timedOut = false;

    const abortHandler = () => {
      terminate(child);
    };
    context.signal?.addEventListener("abort", abortHandler, { once: true });
    const timeoutMs = cfg.timeout ?? 300_000;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, timeoutMs);

    if (!isArgumentMode) {
      child.stdin.end(message);
    } else {
      child.stdin.end();
    }

    try {
      const result = yield* this.streamOutput(child, cfg.output ?? "jsonl");
      if (context.signal?.aborted) {
        throw context.signal.reason ?? new DOMException("CLI request cancelled", "AbortError");
      }
      if (timedOut) {
        const detail = result.stderr.trim();
        throw new Error(`CLI process timed out after ${timeoutMs}ms${detail ? `: ${detail}` : ""}`);
      }
      if (result.error) throw result.error;
      if (result.code !== 0) {
        const detail = result.stderr.trim();
        throw new Error(
          `CLI process exited with code ${result.code ?? "unknown"}${detail ? `: ${detail}` : ""}`,
        );
      }
      yield { type: "done", content: "" };
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", abortHandler);
      this.child = null;
    }
  }

  private async *streamOutput(
    child: ChildProcess,
    outputMode: CliOutputMode,
  ): AsyncGenerator<StreamChunk, ProcessResult> {
    let stdoutBuffer = "";
    let stderr = "";
    let processError: Error | undefined;
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("error", (error) => { processError = error; });
      child.once("close", (code, signal) => resolve({ code, signal }));
    });

    const flushJsonLine = (line: string): StreamChunk | null => {
      if (!line.trim()) return null;
      try {
        const parsed = JSON.parse(line);
        const text = formatJsonLine(parsed);
        return text ? { type: "text", content: text + "\n" } : null;
      } catch {
        return { type: "text", content: line + "\n" };
      }
    };

    const flushCodexJson = (line: string): StreamChunk | null => {
      if (!line.trim()) return null;
      try {
        const parsed = JSON.parse(line);
        const text = parseCodexJson(parsed);
        return text ? { type: "text", content: text } : null;
      } catch {
        return { type: "text", content: line + "\n" };
      }
    };

    const flushBuffer = (): StreamChunk[] => {
      const chunks: StreamChunk[] = [];
      if (!stdoutBuffer.trim()) {
        stdoutBuffer = "";
        return chunks;
      }

      if (outputMode === "json") {
        const chunk = flushCodexJson(stdoutBuffer);
        if (chunk) chunks.push(chunk);
        stdoutBuffer = "";
        return chunks;
      }

      const lines = stdoutBuffer.split(/\r?\n/u);
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const chunk = outputMode === "codex-json"
          ? flushCodexJson(line)
          : outputMode === "plain"
            ? { type: "text" as const, content: line + "\n" }
            : flushJsonLine(line);
        if (chunk) chunks.push(chunk);
      }

      return chunks;
    };

    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 32_000) stderr = stderr.slice(-32_000);
    });

    for await (const raw of child.stdout!) {
      stdoutBuffer += Buffer.isBuffer(raw) ? raw.toString() : String(raw);
      const chunks = flushBuffer();
      for (const chunk of chunks) yield chunk;
    }

    if (outputMode !== "json" && stdoutBuffer) stdoutBuffer += "\n";
    for (const chunk of flushBuffer()) yield chunk;
    const result = await closed;
    return { ...result, stderr, error: processError };
  }

  destroy(): void {
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
      setTimeout(() => {
        if (this.child && !this.child.killed) this.child.kill("SIGKILL");
      }, 3000);
    }
  }
}

function terminate(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 3000).unref();
}
