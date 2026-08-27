/**
 * Protocol-level policy constants shared by server, relay, and web.
 *
 * These values are part of the wire/behavioral contract between components
 * (e.g. relay pong window vs hub heartbeat interval), so they must have a
 * single source of truth instead of per-package literals.
 */

// ─── A2A calls ──────────────────────────────────────────────
export const DEFAULT_A2A_CALL_TIMEOUT_MINUTES = 5;
export const MIN_A2A_CALL_TIMEOUT_MINUTES = 1;
export const MAX_A2A_CALL_TIMEOUT_MINUTES = 30;
export const MIN_A2A_CALL_TIMEOUT_MS = MIN_A2A_CALL_TIMEOUT_MINUTES * 60_000;
export const MAX_A2A_CALL_TIMEOUT_MS = MAX_A2A_CALL_TIMEOUT_MINUTES * 60_000;

export const DEFAULT_A2A_MAX_ROUNDS = 12;
export const MIN_A2A_MAX_ROUNDS = 1;
export const MAX_A2A_MAX_ROUNDS = 50;

// ─── Cross-device transport ─────────────────────────────────
/** How long offline messages stay deliverable (relay retention and hub queue TTL). */
export const DEFAULT_OFFLINE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const MS_PER_DAY = 24 * 60 * 60 * 1_000;

/** Application-level keepalive cadence for hub↔relay and web↔server links. */
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const PONG_TIMEOUT_MS = 10_000;

// ─── Message limits ─────────────────────────────────────────
/** Maximum user message content length accepted on WS and REST paths. */
export const MAX_MESSAGE_CONTENT_LENGTH = 32_000;
