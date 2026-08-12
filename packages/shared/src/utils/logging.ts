export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogSource = "frontend" | "backend" | "relay" | "desktop";

export interface LogEntry {
  id?: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  data?: unknown;
  source: LogSource;
}

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 12;
const SENSITIVE_KEY =
  /(?:authorization|cookie|credential|password|passwd|secret|token|api[-_]?key|private[-_]?key|access[-_]?key|refresh[-_]?token)/iu;

function sanitizeText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/giu, `Bearer ${REDACTED}`)
    .replace(
      /\b(api[-_]?key|password|passwd|secret|token|access[-_]?key|refresh[-_]?token)(\s*[=:]\s*)([^\s,;]+)/giu,
      (_match, key: string, separator: string) => `${key}${separator}${REDACTED}`,
    )
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gu, REDACTED);
}

function sanitize(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol" || typeof value === "function") return String(value);
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeText(value.message),
      ...(value.stack ? { stack: sanitizeText(value.stack) } : {}),
    };
  }
  if (value instanceof Date) return value.toISOString();

  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => sanitize(item, seen, depth + 1));
    }
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitize(item, seen, depth + 1);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

/** Removes common credentials before a value is displayed, persisted, or exported. */
export function sanitizeLogValue(value: unknown): unknown {
  return sanitize(value, new WeakSet<object>(), 0);
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value);
}
