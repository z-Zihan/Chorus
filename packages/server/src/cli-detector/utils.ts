import { normalize } from "node:path";

const MAX_OUTPUT_BYTES = 64 * 1024;

export function appendLimited(
  current: Buffer<ArrayBufferLike>,
  chunk: Buffer<ArrayBufferLike>,
): Buffer<ArrayBufferLike> {
  if (current.length >= MAX_OUTPUT_BYTES) return current;
  return Buffer.concat([current, chunk.subarray(0, MAX_OUTPUT_BYTES - current.length)]);
}

export function firstOutputLine(output: string): string | undefined {
  const line = output.split(/\r?\n/u).find((candidate) => candidate.trim());
  return line?.trim().slice(0, 240);
}

export function normalizeForComparison(path: string): string {
  const normalized = normalize(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

export function abortError(): Error {
  const error = new Error("CLI detection aborted");
  error.name = "AbortError";
  return error;
}
