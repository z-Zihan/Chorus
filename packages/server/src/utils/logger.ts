import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { Writable } from "node:stream";
import pino from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ServerLogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  data?: unknown;
  source: "backend";
}

const MAX_MEMORY_LOGS = 500;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROTATED_FILES = 5;
const LOG_FILE = resolve(process.env.SERVER_LOG_FILE?.trim() || "data/logs/server.log");
const isProduction = process.env.NODE_ENV === "production";
const recentLogs: ServerLogEntry[] = [];

const levelNames: Record<number, LogLevel> = {
  10: "debug",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "error",
};

const levelColors: Record<LogLevel, string> = {
  debug: "\u001b[90m",
  info: "\u001b[36m",
  warn: "\u001b[33m",
  error: "\u001b[31m",
};

function normalizeLog(record: Record<string, unknown>): ServerLogEntry {
  const level = levelNames[Number(record.level)] ?? "info";
  const data = { ...record };
  delete data.level;
  delete data.time;
  delete data.msg;
  delete data.pid;
  delete data.hostname;
  delete data.service;
  return {
    timestamp: typeof record.time === "number" ? record.time : Date.now(),
    level,
    message: typeof record.msg === "string" ? record.msg : "",
    ...(Object.keys(data).length > 0 ? { data } : {}),
    source: "backend",
  };
}

function remember(entry: ServerLogEntry): void {
  recentLogs.push(entry);
  if (recentLogs.length > MAX_MEMORY_LOGS) {
    recentLogs.splice(0, recentLogs.length - MAX_MEMORY_LOGS);
  }
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

class StructuredLogStream extends Writable {
  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const line = chunk.toString();
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      const entry = normalizeLog(record);
      remember(entry);

      if (isProduction) {
        mkdirSync(dirname(LOG_FILE), { recursive: true });
        rotateLogFile(Buffer.byteLength(line));
        appendFileSync(LOG_FILE, line);
      } else {
        const color = levelColors[entry.level];
        const details = entry.data === undefined ? "" : ` ${JSON.stringify(entry.data)}`;
        process.stdout.write(`${color}[${new Date(entry.timestamp).toISOString()}] ${entry.level.toUpperCase()}\u001b[0m ${entry.message}${details}\n`);
      }
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

export const logger = pino(
  {
    level: process.env.SERVER_LOG_LEVEL?.trim() || "info",
    base: { service: "chorus-server" },
    timestamp: pino.stdTimeFunctions.epochTime,
  },
  new StructuredLogStream(),
);

export function getServerLogs(level?: LogLevel, limit = MAX_MEMORY_LOGS): ServerLogEntry[] {
  const filtered = level ? recentLogs.filter((entry) => entry.level === level) : recentLogs;
  return filtered.slice(-Math.max(0, limit));
}

export { LOG_FILE as serverLogFile };
