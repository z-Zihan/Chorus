import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CLI_DESCRIPTORS,
  descriptorForExecutablePath,
  executableFilenames,
  getCliDescriptor,
  mapWithConcurrency,
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

describe("mapWithConcurrency", () => {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("preserves input order in the results", async () => {
    const values = [30, 5, 20, 1, 10];

    const results = await mapWithConcurrency(
      values.map((ms, index) => ({ ms, index })),
      3,
      async ({ ms, index }) => {
        await delay(ms);
        return `result-${index}`;
      },
    );

    expect(results).toEqual(["result-0", "result-1", "result-2", "result-3", "result-4"]);
  });

  it("never runs more mappers than the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(
      Array.from({ length: 10 }, (_, index) => index),
      2,
      async (value) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await delay(value % 3);
        inFlight -= 1;
        return value;
      },
    );

    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBe(2);
  });

  it("returns an empty array for empty input", async () => {
    let calls = 0;

    const results = await mapWithConcurrency([], 3, async () => {
      calls += 1;
    });

    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });

  it("rejects with AbortError without calling the mapper when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;

    await expect(
      mapWithConcurrency(
        [1, 2, 3],
        2,
        async (value) => {
          calls += 1;
          return value;
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(0);
  });

  it("rejects when a mapper throws", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (value) => {
        if (value === 2) throw new Error("mapper failed");
        return value;
      }),
    ).rejects.toThrow("mapper failed");
  });
});
