import { track } from "@/utils/analytics";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  data?: unknown;
  source: "frontend";
}

const MAX_LOGS = 500;
const entries: Array<LogEntry | undefined> = new Array(MAX_LOGS);
let nextIndex = 0;
let entryCount = 0;

const consoleColors: Record<LogLevel, string> = {
  debug: "color: #71717a",
  info: "color: #4f46e5",
  warn: "color: #d97706",
  error: "color: #dc2626; font-weight: 600",
};

function stringifyMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function write(level: LogLevel, message: unknown, data?: unknown): void {
  const entry: LogEntry = {
    timestamp: Date.now(),
    level,
    message: stringifyMessage(message),
    ...(data === undefined ? {} : { data }),
    source: "frontend",
  };

  entries[nextIndex] = entry;
  nextIndex = (nextIndex + 1) % MAX_LOGS;
  entryCount = Math.min(entryCount + 1, MAX_LOGS);

  if (import.meta.env.DEV) {
    const method = level === "debug" ? "debug" : level;
    const time = new Date(entry.timestamp).toISOString();
    console[method](
      `%c[${time}] [${level.toUpperCase()}] ${entry.message}`,
      consoleColors[level],
      data ?? "",
    );
  }
}

export const logger = {
  debug: (message: unknown, data?: unknown) => write("debug", message, data),
  info: (message: unknown, data?: unknown) => write("info", message, data),
  warn: (message: unknown, data?: unknown) => write("warn", message, data),
  error: (message: unknown, data?: unknown) => write("error", message, data),
};

export function getLogs(level?: LogLevel, limit = MAX_LOGS): LogEntry[] {
  const ordered: LogEntry[] = [];
  const start = entryCount === MAX_LOGS ? nextIndex : 0;
  for (let offset = 0; offset < entryCount; offset += 1) {
    const entry = entries[(start + offset) % MAX_LOGS];
    if (entry && (!level || entry.level === level)) ordered.push(entry);
  }
  return ordered.slice(-Math.max(0, limit));
}

export function exportLogs(level?: LogLevel, limit?: number): string {
  return JSON.stringify(getLogs(level, limit), null, 2);
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    const message = event.message || stringifyMessage(event.error) || "Unknown window error";
    logger.error(message, {
      source: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
    track("error_occurred", {
      message,
      source: event.filename || "window.onerror",
      lineno: event.lineno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const message = stringifyMessage(event.reason);
    logger.error(message, {
      source: "unhandledrejection",
      stack: event.reason instanceof Error ? event.reason.stack : undefined,
    });
    track("error_occurred", { message, source: "unhandledrejection", lineno: 0 });
  });
}
