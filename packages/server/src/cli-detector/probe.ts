import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { CliDetection, CliReadiness } from "@chorus/shared";
import type { CliDescriptor } from "./descriptors.js";
import type { ExecutableCandidate } from "./path-scanner.js";
import {
  abortError,
  appendLimited,
  firstOutputLine,
  normalizeForComparison,
  throwIfAborted,
} from "./utils.js";

export interface ProbeResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  errorCode?: string;
}

// Grace window between SIGTERM and SIGKILL, mirroring the CLI adapter's
// terminate ladder (packages/server/src/agent/adapters/cli.ts): a probe that
// traps or ignores SIGTERM would otherwise outlive us as an orphaned process.
const KILL_ESCALATION_MS = 3_000;

export async function probeExecutable(
  executablePath: string,
  descriptor: CliDescriptor,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  throwIfAborted(signal);
  return new Promise<ProbeResult>((resolve, reject) => {
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let timedOut = false;
    let settled = false;
    let spawnErrorCode: string | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const child = spawn(executablePath, descriptor.versionProbe.args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    // SIGTERM first for a graceful exit, then SIGKILL after a grace window so a
    // CLI that catches/ignores SIGTERM cannot linger. shell:false single-process
    // probes have no child tree, so a direct SIGKILL suffices (no taskkill /T).
    const escalateKill = () => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, KILL_ESCALATION_MS);
      // Never let the pending SIGKILL keep the process alive, and drop it as soon
      // as the child exits on its own so no stray timer survives the probe.
      killTimer.unref();
      child.once("close", () => clearTimeout(killTimer));
    };

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", abortHandler);
      resolve({
        exitCode,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        timedOut,
        errorCode: spawnErrorCode,
      });
    };

    const abortHandler = () => {
      // An aborted probe must not strand a process either: escalate to SIGKILL
      // exactly as the timeout path does. The escalation timer is cleared by the
      // child's own "close" listener registered in escalateKill().
      escalateKill();
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(abortError());
    };

    const timer = setTimeout(() => {
      timedOut = true;
      escalateKill();
    }, descriptor.versionProbe.timeoutMs);

    signal?.addEventListener("abort", abortHandler, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      spawnErrorCode = error.code;
    });
    child.once("close", finish);
  });
}

export async function probeCandidate(
  candidate: ExecutableCandidate,
  signal?: AbortSignal,
): Promise<CliDetection> {
  const probe = await probeExecutable(candidate.executablePath, candidate.descriptor, signal);
  const combinedOutput = `${probe.stdout}\n${probe.stderr}`.trim();
  const status = readinessFromProbe(probe, combinedOutput);
  const version = probe.exitCode === 0 ? firstOutputLine(combinedOutput) : undefined;
  const fingerprint = createHash("sha256")
    .update(`${normalizeForComparison(candidate.resolvedPath)}\0${version ?? ""}`)
    .digest("hex");

  return {
    id: fingerprint.slice(0, 16),
    descriptorId: candidate.descriptor.id,
    displayName: candidate.descriptor.displayName,
    executablePath: candidate.executablePath,
    resolvedPath: candidate.resolvedPath,
    version,
    status,
    source: candidate.source,
    diagnosticsCode: diagnosticsFromProbe(probe, status),
    detectedAt: Date.now(),
    fingerprint,
  };
}

export function readinessFromProbe(probe: ProbeResult, output: string): CliReadiness {
  if (probe.timedOut) return "error";
  if (probe.exitCode === 0) return "ready";
  if (/auth(?:entication)? required|not logged in|login required|unauthorized/iu.test(output)) {
    return "needs_auth";
  }
  if (/unsupported|requires? (?:node|version)|version too old/iu.test(output)) return "unsupported";
  return "error";
}

export function diagnosticsFromProbe(probe: ProbeResult, status: CliReadiness): string | undefined {
  if (probe.timedOut) return "PROBE_TIMEOUT";
  if (probe.errorCode === "EACCES" || probe.errorCode === "EPERM") return "PERMISSION_DENIED";
  if (probe.errorCode === "ENOENT") return "CLI_NOT_FOUND";
  if (status === "needs_auth") return "AUTH_REQUIRED";
  if (status === "unsupported") return "VERSION_UNSUPPORTED";
  if (status === "error") return "PROBE_FAILED";
  return undefined;
}
