import { constants as fsConstants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { basename } from "node:path";
import type { CliDetection } from "@agentlink/shared";
import { CLI_DESCRIPTORS, type CliDescriptor } from "./descriptors.js";
import { scanPath } from "./path-scanner.js";
import { probeCandidate } from "./probe.js";
import {
  abortError as createAbortError,
  appendLimited as limitOutput,
  firstOutputLine as getFirstOutputLine,
  normalizeForComparison as normalizePathForComparison,
  throwIfAborted as assertNotAborted,
} from "./utils.js";

export { scanPath };
export { probeExecutable } from "./probe.js";
export type { ProbeResult } from "./probe.js";

export async function detect(signal?: AbortSignal): Promise<CliDetection[]> {
  const candidates = await scanPath(signal);
  return mapWithConcurrency(candidates, 3, (candidate) => probeCandidate(candidate, signal), signal);
}

export async function detectSelectedExecutable(
  executablePath: string,
  descriptor: CliDescriptor,
  signal?: AbortSignal,
): Promise<CliDetection> {
  throwIfAborted(signal);
  await access(executablePath, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
  const resolvedPath = await realpath(executablePath);
  return probeCandidate(
    { descriptor, executablePath, resolvedPath, source: "user_selected" },
    signal,
  );
}

export function descriptorForExecutablePath(executablePath: string): CliDescriptor | undefined {
  const filename = basename(executablePath).toLowerCase().replace(/\.(exe|cmd|bat)$/u, "");
  return CLI_DESCRIPTORS.find((descriptor) => {
    const names = descriptor.executableNames[process.platform] ?? [descriptor.executable];
    return names.some((name) => name.toLowerCase() === filename);
  });
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      throwIfAborted(signal);
      const index = nextIndex++;
      const value = values[index];
      if (value !== undefined) results[index] = await mapper(value);
    }
  });
  await Promise.all(workers);
  return results;
}

export function appendLimited(
  current: Buffer<ArrayBufferLike>,
  chunk: Buffer<ArrayBufferLike>,
): Buffer<ArrayBufferLike> {
  return limitOutput(current, chunk);
}

export function firstOutputLine(output: string): string | undefined {
  return getFirstOutputLine(output);
}

export function normalizeForComparison(path: string): string {
  return normalizePathForComparison(path);
}

export function throwIfAborted(signal?: AbortSignal): void {
  assertNotAborted(signal);
}

export function abortError(): Error {
  return createAbortError();
}
