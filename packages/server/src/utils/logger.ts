import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { Writable } from "node:stream";
import {
  isLogLevel,
  sanitizeLogValue,
  type LogEntry,
  type LogLevel,
  type LogSource,
} from "@chorus/shared";
import pino from "pino";

export type ServerLogEntry = LogEntry;

const MAX_MEMORY_LOGS = 2_000;
const MAX_FILE_BYTES = positiveInteger(process.env.SERVER_LOG_MAX_BYTES, 5 * 1024 * 1024);
const MAX_ROTATED_FILES = positiveInteger(process.env.SERVER_LOG_MAX_FILES, 5);
const LOG_FILE = resolve(process.env.SERVER_LOG_FILE?.trim() || "data/logs/server.log");
const isDevelopment = process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";
const shouldPersist = process.env.NODE_ENV !== "test";
const recentLogs: ServerLogEntry[] = [];
const recentLogIds = new Set<string>();

// A packaged sidecar can briefly outlive its parent while the desktop process
// is shutting down. A closed stdout pipe must not recursively crash logging.
process.stdout.on("error", () => undefined);

const levelNames: Record<number, LogLevel> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

const levelColors: Record<LogLevel, string> = {
  trace: "\u001b[90m",
  debug: "\u001b[90m",
  info: "\u001b[36m",
  warn: "\u001b[33m",
  error: "\u001b[31m",
  fatal: "\u001b[35m",
};

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function logSource(value: unknown): LogSource {
  return value === "frontend" || value === "relay" || value === "desktop" ? value : "backend";
}

function normalizeLog(record: Record<string, unknown>): ServerLogEntry {
  const data = { ...record };
  delete data.level;
  delete data.time;
  delete data.msg;
  delete data.pid;
  delete data.hostname;
  delete data.service;
  delete data.source;
  delete data.logId;
  const sanitizedData = sanitizeLogValue(data);
  return {
    ...(typeof record.logId === "string" ? { id: record.logId } : {}),
    timestamp: typeof record.time === "number" ? record.time : Date.now(),
    level: levelNames[Number(record.level)] ?? "info",
    message: String(sanitizeLogValue(typeof record.msg === "string" ? record.msg : "")),
    ...(sanitizedData && typeof sanitizedData === "object" && Object.keys(sanitizedData).length > 0
      ? { data: sanitizedData }
      : {}),
    source: logSource(record.source),
  };
}

function remember(entry: ServerLogEntry): boolean {
  if (entry.id && recentLogIds.has(entry.id)) return false;
  recentLogs.push(entry);
  if (entry.id) recentLogIds.add(entry.id);
  if (recentLogs.length > MAX_MEMORY_LOGS) {
    const removed = recentLogs.splice(0, recentLogs.length - MAX_MEMORY_LOGS);
    for (const item of removed) if (item.id) recentLogIds.delete(item.id);
  }
  return true;
}

function rotateLogFile(nextBytes: number): void {
  const currentBytes = existsSync(LOG_FILE) ? statSync(LOG_FILE).size : 0;
  if (currentBytes + nextBytes <= MAX_FILE_BYTES) return;

  for (let index = MAX_ROTATED_FILES - 1; index >= 1; index -= 1) {
    const source = `${LOG_FILE}.${index}`;
    const target = `${LOG_FILE}.${index + 1}`;
    if (!existsSync(source)) continue;
    if (existsSync(target)) unlinkSync(target);
    renameSync(source, target);
  }
  if (existsSync(`${LOG_FILE}.1`)) unlinkSync(`${LOG_FILE}.1`);
  if (existsSync(LOG_FILE)) renameSync(LOG_FILE, `${LOG_FILE}.1`);
}

function persist(entry: ServerLogEntry): void {
  if (!shouldPersist) return;
  const line = `${JSON.stringify(entry)}\n`;
  mkdirSync(dirname(LOG_FILE), { recursive: true });
  rotateLogFile(Buffer.byteLength(line));
  appendFileSync(LOG_FILE, line);
}

function emit(entry: ServerLogEntry): void {
  if (!remember(entry)) return;
  persist(entry);
  if (isDevelopment) {
    const color = levelColors[entry.level];
    const details = entry.data === undefined ? "" : ` ${JSON.stringify(entry.data)}`;
    process.stdout.write(
      `${color}[${new Date(entry.timestamp).toISOString()}] ${entry.level.toUpperCase()}\u001b[0m ${entry.message}${details}\n`,
    );
  }
}

function loadPersistedLogs(): void {
  if (!shouldPersist) return;
  const files: string[] = [];
  for (let index = MAX_ROTATED_FILES; index >= 1; index -= 1) {
    files.push(`${LOG_FILE}.${index}`);
  }
  files.push(LOG_FILE);
  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line) as Partial<ServerLogEntry>;
        if (
          typeof entry.timestamp === "number" &&
          isLogLevel(entry.level) &&
          typeof entry.message === "string"
        ) {
          remember({
            ...(typeof entry.id === "string" ? { id: entry.id } : {}),
            timestamp: entry.timestamp,
            level: entry.level,
            message: String(sanitizeLogValue(entry.message)),
            ...(entry.data === undefined ? {} : { data: sanitizeLogValue(entry.data) }),
            source: logSource(entry.source),
          });
        }
      }
    } catch {
      // A corrupt or concurrently rotated diagnostics file must not block startup.
    }
  }
}

class StructuredLogStream extends Writable {
  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      emit(normalizeLog(JSON.parse(chunk.toString()) as Record<string, unknown>));
    } catch {
      // Diagnostics must never bring down the local service.
    }
    callback();
  }
}

loadPersistedLogs();

export const logger = pino(
  {
    level: process.env.SERVER_LOG_LEVEL?.trim() || "info",
    base: { service: "chorus-server" },
    timestamp: pino.stdTimeFunctions.epochTime,
  },
  new StructuredLogStream(),
);

export function ingestLogEntries(entries: readonly LogEntry[]): void {
  for (const entry of entries) {
    emit({
      ...(entry.id ? { id: entry.id } : {}),
      timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
      level: isLogLevel(entry.level) ? entry.level : "info",
      message: String(sanitizeLogValue(entry.message)),
      ...(entry.data === undefined ? {} : { data: sanitizeLogValue(entry.data) }),
      source: logSource(entry.source),
    });
  }
}

export function getServerLogs(
  level?: LogLevel,
  limit = MAX_MEMORY_LOGS,
  source?: LogSource,
): ServerLogEntry[] {
  const filtered = recentLogs.filter(
    (entry) => (!level || entry.level === level) && (!source || entry.source === source),
  );
  return filtered.slice(-Math.max(0, limit));
}

export { LOG_FILE as serverLogFile };
