import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CliDescriptor } from "../descriptors.js";
import { probeExecutable } from "../probe.js";

// probeExecutable only reads versionProbe, so a minimal descriptor is enough.
function descriptor(args: string[], timeoutMs: number): CliDescriptor {
  return { versionProbe: { args, timeoutMs, output: "text" } } as unknown as CliDescriptor;
}

async function writeScript(dir: string, name: string, source: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, source, "utf8");
  return path;
}

/** Poll a pid-file written by a spawned script until it appears. */
async function readPid(pidFile: string, timeoutMs = 2_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = (await readFile(pidFile, "utf8")).trim();
      if (raw) return Number(raw);
    } catch {
      // Not written yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("pid file was never written");
}

/** Resolve once `process.kill(pid, 0)` reports the process is gone (ESRCH). */
async function waitForExit(pid: number, timeoutMs = 6_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

// Writes its pid, then traps SIGTERM and never exits — only SIGKILL can stop it.
const SIGTERM_TRAP = [
  'const fs = require("node:fs");',
  "fs.writeFileSync(process.argv[2], String(process.pid));",
  "process.on('SIGTERM', () => {});",
  "setInterval(() => {}, 1000);",
  "console.log('alive');",
].join("\n");

describe("probeExecutable", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("resolves normally for a fast-exiting executable", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "probe-fast-"));
    const script = await writeScript(tempDir, "fast.cjs", "console.log('v1.2.3');");

    const result = await probeExecutable(process.execPath, descriptor([script], 2_000));

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("v1.2.3");
  });

  // SIGTERM handlers do not exist on Windows, so the trap trick only works on
  // POSIX. SIGKILL escalation itself (TerminateProcess) works everywhere.
  it.skipIf(process.platform === "win32")(
    "escalates to SIGKILL when a probe traps SIGTERM and times out",
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), "probe-trap-"));
      const script = await writeScript(tempDir, "trap.cjs", SIGTERM_TRAP);
      const pidFile = join(tempDir, "pid");

      const result = await probeExecutable(process.execPath, descriptor([script, pidFile], 300));

      expect(result.timedOut).toBe(true);
      const pid = await readPid(pidFile);
      expect(await waitForExit(pid)).toBe(true);
    },
    15_000,
  );

  it.skipIf(process.platform === "win32")(
    "escalates to SIGKILL when a probe is aborted mid-run",
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), "probe-abort-"));
      const script = await writeScript(tempDir, "trap.cjs", SIGTERM_TRAP);
      const pidFile = join(tempDir, "pid");

      const controller = new AbortController();
      const probe = probeExecutable(
        process.execPath,
        descriptor([script, pidFile], 10_000),
        controller.signal,
      );
      setTimeout(() => controller.abort(), 100);

      await expect(probe).rejects.toMatchObject({ name: "AbortError" });
      const pid = await readPid(pidFile);
      expect(await waitForExit(pid)).toBe(true);
    },
    15_000,
  );
});
