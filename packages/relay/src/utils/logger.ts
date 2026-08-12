import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Writable } from "node:stream";
import { sanitizeLogValue, type LogEntry, type LogLevel } from "@chorus/shared";
import pino from "pino";

const LOG_FILE = resolve(process.env.RELAY_LOG_FILE?.trim() || "data/logs/relay.log");
const MAX_FILE_BYTES = positiveInteger(process.env.RELAY_LOG_MAX_BYTES, 5 * 1024 * 1024);
const MAX_FILES = positiveInteger(process.env.RELAY_LOG_MAX_FILES, 5);
const isDevelopment = process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";
const shouldPersist = process.env.NODE_ENV !== "test";

const levels: Record<number, LogLevel> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalize(record: Record<string, unknown>): LogEntry {
  const data = { ...record };
  delete data.level;
  delete data.time;
  delete data.msg;
  delete data.pid;
  delete data.hostname;
  delete data.service;
  const sanitizedData = sanitizeLogValue(data);
  return {
    timestamp: typeof record.time === "number" ? record.time : Date.now(),
    level: levels[Number(record.level)] ?? "info",
    message: String(sanitizeLogValue(typeof record.msg === "string" ? record.msg : "")),
    ...(sanitizedData && typeof sanitizedData === "object" && Object.keys(sanitizedData).length > 0
      ? { data: sanitizedData }
      : {}),
    source: "relay",
  };
}

function rotate(nextBytes: number): void {
  const currentBytes = existsSync(LOG_FILE) ? statSync(LOG_FILE).size : 0;
  if (currentBytes + nextBytes <= MAX_FILE_BYTES) return;
  for (let index = MAX_FILES - 1; index >= 1; index -= 1) {
    const source = `${LOG_FILE}.${index}`;
    const target = `${LOG_FILE}.${index + 1}`;
    if (!existsSync(source)) continue;
    if (existsSync(target)) unlinkSync(target);
    renameSync(source, target);
  }
  if (existsSync(`${LOG_FILE}.1`)) unlinkSync(`${LOG_FILE}.1`);
  if (existsSync(LOG_FILE)) renameSync(LOG_FILE, `${LOG_FILE}.1`);
}

class RelayLogStream extends Writable {
  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      const entry = normalize(JSON.parse(chunk.toString()) as Record<string, unknown>);
      const line = `${JSON.stringify(entry)}\n`;
      if (shouldPersist) {
        mkdirSync(dirname(LOG_FILE), { recursive: true });
        rotate(Buffer.byteLength(line));
        appendFileSync(LOG_FILE, line);
      }
      if (isDevelopment) {
        const details = entry.data === undefined ? "" : ` ${JSON.stringify(entry.data)}`;
        process.stdout.write(
          `[${new Date(entry.timestamp).toISOString()}] ${entry.level.toUpperCase()} ${entry.message}${details}\n`,
        );
      }
    } catch {
      // Logging failures must not terminate the relay.
    }
    callback();
  }
}

process.stdout.on("error", () => undefined);

export const logger = pino(
  {
    level: process.env.RELAY_LOG_LEVEL?.trim() || "info",
    base: { service: "chorus-relay" },
    timestamp: pino.stdTimeFunctions.epochTime,
  },
  new RelayLogStream(),
);

export { LOG_FILE as relayLogFile };
