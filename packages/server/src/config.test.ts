import { existsSync } from "node:fs";
import type * as NodeFs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof NodeFs>();
  return { ...original, existsSync: vi.fn(original.existsSync) };
});

import { hasExistingConfig, loadConfig, resolveAppDataDir } from "./config.js";

const mockedExistsSync = vi.mocked(existsSync);
const originalCwd = process.cwd();
let temporaryDirectory: string | undefined;

beforeEach(() => {
  mockedExistsSync.mockReset();
  vi.unstubAllEnvs();
});

afterEach(async () => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = undefined;
  }
});

describe("config migration", () => {
  it("returns defaults with no agents when no config file exists", async () => {
    mockedExistsSync.mockReturnValue(false);

    const loaded = await loadConfig();

    expect(loaded.source).toBe("defaults");
    expect(loaded.rootDir).toBe(process.cwd());
    expect(loaded.config).toMatchObject({ port: 3210, agents: [], auth: { enabled: false } });
    expect(hasExistingConfig()).toBe(false);
  });

  it("continues to load an existing chorus.config.ts", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "chorus-config-"));
    let configPath = join(temporaryDirectory, "chorus.config.ts");
    await writeFile(
      configPath,
      `export default {
        port: 4321,
        agents: [{ id: "legacy", name: "Legacy", type: "mock", config: {} }],
      };`,
      "utf8",
    );
    process.chdir(temporaryDirectory);
    configPath = join(process.cwd(), "chorus.config.ts");
    mockedExistsSync.mockImplementation((path) => String(path) === configPath);

    expect(hasExistingConfig()).toBe(true);
    const loaded = await loadConfig();

    expect(loaded.source).toBe("explicit_config");
    expect(loaded.rootDir).toBe(process.cwd());
    expect(loaded.config.port).toBe(4321);
    expect(loaded.config.agents).toEqual([
      { id: "legacy", name: "Legacy", type: "mock", config: {} },
    ]);
    expect(loaded.config.history).toEqual({ maxMessages: 20, maxTokens: 8_000 });
  });
});

describe("resolveAppDataDir", () => {
  it.each([
    ["darwin", join(homedir(), "Library", "Application Support", "Chorus")],
    ["win32", join("C:\\Users\\agent\\AppData\\Roaming", "Chorus")],
    ["linux", join("/var/lib/agent", "chorus")],
  ] as const)("returns the platform data directory on %s", (platform, expected) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform);
    vi.stubEnv("APPDATA", platform === "win32" ? "C:\\Users\\agent\\AppData\\Roaming" : "");
    vi.stubEnv("XDG_DATA_HOME", platform === "linux" ? "/var/lib/agent" : "");

    expect(resolveAppDataDir()).toBe(expected);
  });
});
