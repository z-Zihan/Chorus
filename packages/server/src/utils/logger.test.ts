import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
let tempDirectory: string | undefined;

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
  if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true });
  tempDirectory = undefined;
});

describe("server logger persistence", () => {
  it("persists sanitized JSON lines, rotates files, and reloads recent history", async () => {
    tempDirectory = mkdtempSync(join(tmpdir(), "chorus-logger-"));
    const logFile = join(tempDirectory, "server.log");
    process.env.NODE_ENV = "production";
    process.env.SERVER_LOG_FILE = logFile;
    process.env.SERVER_LOG_MAX_BYTES = "450";
    process.env.SERVER_LOG_MAX_FILES = "2";

    const first = await import("./logger.js");
    for (let index = 0; index < 12; index += 1) {
      first.logger.info({ index, apiKey: "sk-very-secret-value" }, `persisted log ${index}`);
    }

    expect(existsSync(logFile)).toBe(true);
    expect(existsSync(`${logFile}.1`)).toBe(true);
    const persisted = [logFile, `${logFile}.1`, `${logFile}.2`]
      .filter(existsSync)
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(persisted).not.toContain("sk-very-secret-value");
    expect(persisted).toContain("[REDACTED]");

    vi.resetModules();
    const restarted = await import("./logger.js");
    expect(
      restarted
        .getServerLogs(undefined, 2_000)
        .some((entry) => entry.message.includes("persisted log")),
    ).toBe(true);
  });
});
