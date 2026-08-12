import {
  isLogLevel,
  isTauri,
  sanitizeLogValue,
  type LogEntry,
  type LogLevel,
} from "@chorus/shared";
import { getApiBaseUrl } from "@/services/env";

export type { LogEntry, LogLevel };

const MAX_LOGS = 500;
const BATCH_SIZE = 100;
const STORAGE_KEY = "chorus:diagnostics:logs:v1";
const entries: LogEntry[] = [];
const pendingIds = new Set<string>();
let flushTimer: ReturnType<typeof window.setTimeout> | undefined;
let retryMs = 1_000;
let transportInitialized = false;

const consoleColors: Record<LogLevel, string> = {
  trace: "color: #71717a",
  debug: "color: #71717a",
  info: "color: #4f46e5",
  warn: "color: #d97706",
  error: "color: #dc2626; font-weight: 600",
  fatal: "color: #a21caf; font-weight: 700",
};

interface StoredLogs {
  entries: LogEntry[];
  pendingIds: string[];
}

function createId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function stringifyMessage(value: unknown): string {
  if (value instanceof Error) return String(sanitizeLogValue(value.message));
  if (typeof value === "string") return String(sanitizeLogValue(value));
  try {
    return JSON.stringify(sanitizeLogValue(value));
  } catch {
    return String(value);
  }
}

function persistLocalState(): void {
  if (typeof window === "undefined") return;
  try {
    const state: StoredLogs = { entries, pendingIds: [...pendingIds] };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Diagnostics storage is best-effort (private mode and quotas may reject it).
  }
}

function restoreLocalState(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as Partial<StoredLogs>;
    for (const entry of stored.entries?.slice(-MAX_LOGS) ?? []) {
      if (
        typeof entry.id !== "string" ||
        typeof entry.timestamp !== "number" ||
        !isLogLevel(entry.level) ||
        typeof entry.message !== "string"
      ) {
        continue;
      }
      entries.push({
        id: entry.id,
        timestamp: entry.timestamp,
        level: entry.level,
        message: String(sanitizeLogValue(entry.message)),
        ...(entry.data === undefined ? {} : { data: sanitizeLogValue(entry.data) }),
        source: "frontend",
      });
    }
    const knownIds = new Set(entries.flatMap((entry) => (entry.id ? [entry.id] : [])));
    for (const id of stored.pendingIds ?? []) if (knownIds.has(id)) pendingIds.add(id);
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

function scheduleFlush(delay = 750): void {
  if (!transportInitialized || flushTimer !== undefined || typeof window === "undefined") return;
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    void flushClientLogs();
  }, delay);
}

function pendingBatch(): LogEntry[] {
  return entries.filter((entry) => entry.id && pendingIds.has(entry.id)).slice(0, BATCH_SIZE);
}

async function flushClientLogs(): Promise<void> {
  const batch = pendingBatch();
  if (batch.length === 0) return;
  try {
    const response = await fetch(`${getApiBaseUrl()}/logs/client`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: batch }),
      keepalive: true,
    });
    if (!response.ok) throw new Error(`Log ingestion failed: ${response.status}`);
    for (const entry of batch) if (entry.id) pendingIds.delete(entry.id);
    retryMs = 1_000;
    persistLocalState();
    if (pendingIds.size > 0) scheduleFlush(0);
  } catch {
    retryMs = Math.min(retryMs * 2, 30_000);
    scheduleFlush(retryMs);
  }
}

function write(level: LogLevel, message: unknown, data?: unknown): void {
  const entry: LogEntry = {
    id: createId(),
    timestamp: Date.now(),
    level,
    message: stringifyMessage(message),
    ...(data === undefined ? {} : { data: sanitizeLogValue(data) }),
    source: "frontend",
  };

  entries.push(entry);
  if (entry.id) pendingIds.add(entry.id);
  if (entries.length > MAX_LOGS) {
    const removed = entries.splice(0, entries.length - MAX_LOGS);
    for (const item of removed) if (item.id) pendingIds.delete(item.id);
  }
  persistLocalState();
  scheduleFlush();

  if (import.meta.env.DEV) {
    const method =
      level === "trace" || level === "debug" ? "debug" : level === "fatal" ? "error" : level;
    console[method](
      `%c[${new Date(entry.timestamp).toISOString()}] [${level.toUpperCase()}] ${entry.message}`,
      consoleColors[level],
      entry.data ?? "",
    );
  }
}

export const logger = {
  trace: (message: unknown, data?: unknown) => write("trace", message, data),
  debug: (message: unknown, data?: unknown) => write("debug", message, data),
  info: (message: unknown, data?: unknown) => write("info", message, data),
  warn: (message: unknown, data?: unknown) => write("warn", message, data),
  error: (message: unknown, data?: unknown) => write("error", message, data),
  fatal: (message: unknown, data?: unknown) => write("fatal", message, data),
};

export function getLogs(level?: LogLevel, limit = MAX_LOGS): LogEntry[] {
  const filtered = level ? entries.filter((entry) => entry.level === level) : entries;
  return filtered.slice(-Math.max(0, limit));
}

export function exportLogs(level?: LogLevel, limit?: number): string {
  return JSON.stringify(getLogs(level, limit), null, 2);
}

export async function getDesktopLogs(limit = 500): Promise<LogEntry[]> {
  if (!isTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  const records = await invoke<Array<Record<string, unknown>>>("get_desktop_logs", { limit });
  return records.flatMap((record, index) => {
    const levelValue = typeof record.level === "string" ? record.level.toLowerCase() : "info";
    if (!isLogLevel(levelValue)) return [];
    const fields =
      record.fields && typeof record.fields === "object"
        ? (record.fields as Record<string, unknown>)
        : {};
    const { message, ...fieldData } = fields;
    const timestamp =
      typeof record.timestamp === "string"
        ? Date.parse(record.timestamp)
        : Number(record.timestamp);
    return [
      {
        id: `desktop-${record.timestamp ?? "unknown"}-${index}`,
        timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
        level: levelValue,
        message: stringifyMessage(message ?? "Desktop event"),
        data: sanitizeLogValue({ ...fieldData, target: record.target }),
        source: "desktop" as const,
      },
    ];
  });
}

export function initializeClientLogging(): void {
  if (transportInitialized || typeof window === "undefined") return;
  transportInitialized = true;
  scheduleFlush(0);
  window.addEventListener("online", () => scheduleFlush(0));
  window.addEventListener("pagehide", () => {
    if (!import.meta.env.PROD) return;
    const batch = pendingBatch();
    if (batch.length === 0 || typeof navigator.sendBeacon !== "function") return;
    const body = new Blob([JSON.stringify({ entries: batch })], { type: "application/json" });
    navigator.sendBeacon(`${getApiBaseUrl()}/logs/client`, body);
  });
}

restoreLocalState();

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    logger.error(event.message || stringifyMessage(event.error) || "Unknown window error", {
      source: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    logger.error(stringifyMessage(event.reason), {
      source: "unhandledrejection",
      stack: event.reason instanceof Error ? event.reason.stack : undefined,
    });
  });
}
