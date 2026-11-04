import { describe, expect, it } from "vitest";
import { CLI_DESCRIPTORS, getCliDescriptor } from "../descriptors.js";
import { descriptorForExecutablePath } from "../detector.js";

const PLATFORMS = ["darwin", "linux", "win32"] as const;
const ADAPTER_OUTPUTS = ["jsonl", "codex-json", "plain", "json"];
const ADAPTER_INPUTS = ["stdin", "argument"];

describe("CLI_DESCRIPTORS invariants", () => {
  it.each(CLI_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor] as const))(
    "%s declares executable names for every platform including its own executable",
    (_id, descriptor) => {
      for (const platform of PLATFORMS) {
        const names = descriptor.executableNames[platform];
        expect(names, platform).toBeDefined();
        expect(names?.map((name) => name.toLowerCase())).toContain(
          descriptor.executable.toLowerCase(),
        );
      }
    },
  );

  it.each(CLI_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor] as const))(
    "%s declares absolute known install dirs for at least one platform",
    (_id, descriptor) => {
      const entries = Object.entries(descriptor.knownInstallDirs);
      expect(entries.length).toBeGreaterThan(0);
      for (const [, dirs] of entries) {
        for (const dir of dirs ?? []) {
          expect(dir.startsWith("/"), dir).toBe(true);
        }
      }
    },
  );

  it.each(CLI_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor] as const))(
    "%s declares a valid version probe and adapter template",
    (_id, descriptor) => {
      expect(descriptor.versionProbe.timeoutMs).toBeGreaterThan(0);
      expect(descriptor.versionProbe.args.length).toBeGreaterThan(0);
      expect(descriptor.versionProbe.output).toBe("text");
      expect(ADAPTER_OUTPUTS).toContain(descriptor.adapterTemplate.output);
      expect(ADAPTER_INPUTS).toContain(descriptor.adapterTemplate.input);
    },
  );

  it("uses non-empty, unique ids and display names", () => {
    const ids = CLI_DESCRIPTORS.map((descriptor) => descriptor.id);
    const displayNames = CLI_DESCRIPTORS.map((descriptor) => descriptor.displayName);

    for (const value of [...ids, ...displayNames]) {
      expect(value.trim()).not.toBe("");
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(displayNames).size).toBe(displayNames.length);
  });
});

describe("getCliDescriptor", () => {
  it.each(CLI_DESCRIPTORS.map((descriptor) => descriptor.id))(
    "returns the descriptor for %s",
    (id) => {
      expect(getCliDescriptor(id)).toBe(CLI_DESCRIPTORS.find((descriptor) => descriptor.id === id));
    },
  );

  it("returns undefined for an unknown id", () => {
    expect(getCliDescriptor("not-a-cli")).toBeUndefined();
    expect(getCliDescriptor("")).toBeUndefined();
  });
});

describe("descriptorForExecutablePath", () => {
  it.each([
    ["/Tools/claude.exe", "claude-code"],
    ["/Tools/codex.cmd", "codex"],
    ["/Tools/gemini.bat", "gemini-cli"],
  ])("strips Windows extensions from %s", (executablePath, descriptorId) => {
    expect(descriptorForExecutablePath(executablePath)?.id).toBe(descriptorId);
  });

  it.each([
    ["/usr/local/bin/CLAUDE", "claude-code"],
    ["/usr/local/bin/OpenCode", "opencode"],
    ["/Tools/AIDER.EXE", "aider"],
    ["/Tools/Qwen.Cmd", "qwen-code"],
  ])("matches %s case-insensitively", (executablePath, descriptorId) => {
    expect(descriptorForExecutablePath(executablePath)?.id).toBe(descriptorId);
  });

  it.each(["/usr/local/bin/unknown-cli", "/usr/local/bin/claude.sh", "/usr/local/bin/claude-code"])(
    "returns undefined for %s",
    (executablePath) => {
      expect(descriptorForExecutablePath(executablePath)).toBeUndefined();
    },
  );
});
