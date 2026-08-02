import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CLI_DESCRIPTORS,
  descriptorForExecutablePath,
  executableFilenames,
  getCliDescriptor,
  type ProbeResult,
} from "../index.js";

describe("CLI descriptor contract", () => {
  it("defines exactly the fourteen supported CLIs", () => {
    expect(CLI_DESCRIPTORS.map((descriptor) => descriptor.id)).toEqual([
      "claude-code",
      "codex",
      "copilot-cli",
      "gemini-cli",
      "aider",
      "qwen-code",
      "cursor-cli",
      "kilo-cli",
      "opencode",
      "hermes-agent",
      "cline",
      "codebuff",
      "trae-agent",
      "iflow-cli",
    ]);
  });

  it("provides the required execution fields for every descriptor", () => {
    for (const descriptor of CLI_DESCRIPTORS) {
      expect(descriptor.executableNames).toBeDefined();
      expect(descriptor.versionProbe).toMatchObject({
        args: expect.any(Array),
        timeoutMs: expect.any(Number),
        output: "text",
      });
      expect(descriptor.adapterTemplate).toMatchObject({
        args: expect.any(Array),
        input: expect.any(String),
        output: expect.any(String),
      });
    }
  });

  it.each([
    ["/usr/local/bin/claude", "claude-code"],
    ["/opt/homebrew/bin/codex", "codex"],
    ["/Tools/copilot.exe", "copilot-cli"],
  ])("matches %s by executable filename", (executablePath, descriptorId) => {
    expect(descriptorForExecutablePath(executablePath)?.id).toBe(descriptorId);
  });

  it.each(["claude-code", "codex", "copilot-cli"])(
    "returns the %s descriptor by id",
    (descriptorId) => {
      expect(getCliDescriptor(descriptorId)?.id).toBe(descriptorId);
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps executable names unchanged on non-Windows platforms",
    () => {
      expect(executableFilenames("claude")).toEqual(["claude"]);
    },
  );

  it("exports the ProbeResult contract", () => {
    const result = {
      exitCode: 0,
      stdout: "1.0.0",
      stderr: "",
      timedOut: false,
    } satisfies ProbeResult;

    expectTypeOf(result).toMatchTypeOf<ProbeResult>();
    expect(result.timedOut).toBe(false);
  });
});
