import { Writable } from "node:stream";
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

class PrettyLogStream extends Writable {
  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      const record = JSON.parse(chunk.toString()) as Record<string, unknown>;
      const time = typeof record.time === "number" ? new Date(record.time).toISOString() : new Date().toISOString();
      const level = typeof record.level === "number"
        ? ({ 10: "TRACE", 20: "DEBUG", 30: "INFO", 40: "WARN", 50: "ERROR", 60: "FATAL" }[record.level] ?? "INFO")
        : "INFO";
      const message = typeof record.msg === "string" ? record.msg : "";
      const details = { ...record };
      delete details.level;
      delete details.time;
      delete details.msg;
      delete details.pid;
      delete details.hostname;
      delete details.service;
      const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : "";
      process.stdout.write(`[${time}] ${level} ${message}${suffix}\n`);
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

const options = {
  level: process.env.RELAY_LOG_LEVEL?.trim() || "info",
  base: { service: "chorus-relay" },
  timestamp: pino.stdTimeFunctions.epochTime,
};

export const logger = isProduction ? pino(options) : pino(options, new PrettyLogStream());
