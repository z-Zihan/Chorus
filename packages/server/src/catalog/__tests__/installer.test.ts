import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogEntryWithStatus, CliDetection, InstallRecipe } from "@chorus/shared";
import { InstallExecutor } from "../installer.js";
import type { CatalogService } from "../index.js";
import type { AgentRegistry } from "../../agent/registry.js";
import type { CliDetector } from "../../cli-detector/index.js";

const FILE_CONTENTS = "hello chorus";
const DESCRIPTOR_ID = "test-tool-descriptor";

function buildEntry(destination: string, checksum: string): CatalogEntryWithStatus {
  const downloadRecipe: InstallRecipe = {
    method: "download",
    executable: "https://example.com/tool",
    args: [destination],
    requiresElevation: false,
    checksum,
  };
  return {
    id: "test-tool",
    name: "Test Tool",
    summary: "A test tool",
    publisher: { name: "Test", url: "https://example.com", verified: false },
    kind: "managed-cli",
    platforms: ["darwin", "linux", "win32"],
    capabilities: [],
    permissions: [],
    homepage: "https://example.com",
    descriptorId: DESCRIPTOR_ID,
    installRecipes: [downloadRecipe],
    uninstallRecipes: [],
    adapterTemplate: { type: "cli", config: {} },
    installed: false,
  };
}

function createExecutor(entry: CatalogEntryWithStatus, forceRescanResult: CliDetection[] = []) {
  const catalog = {
    getCached: vi.fn().mockReturnValue(entry),
  } as unknown as CatalogService;
  const registry = {
    get: vi.fn().mockReturnValue(undefined),
    registerAndPersist: vi.fn().mockResolvedValue({ id: "test-tool-agent" }),
  } as unknown as AgentRegistry;
  const detector = {
    forceRescan: vi.fn().mockResolvedValue(forceRescanResult),
  } as unknown as CliDetector;
  return new InstallExecutor(catalog, registry, detector);
}

async function waitForTerminalStage(executor: InstallExecutor, id: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const status = executor.get(id);
    if (status && (status.stage === "done" || status.stage === "error")) return status;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for installation to reach a terminal stage");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InstallExecutor download checksum verification", () => {
  it("writes the file and completes installation when the checksum matches", async () => {
    const destination = join(tmpdir(), `chorus-installer-test-${randomUUID()}`);
    const checksum = createHash("sha256").update(FILE_CONTENTS).digest("hex");
    const entry = buildEntry(destination, checksum);
    const detection: CliDetection = {
      id: "detection-1",
      descriptorId: DESCRIPTOR_ID,
      displayName: "Test Tool",
      executablePath: destination,
      resolvedPath: destination,
      status: "ready",
      source: "known_dir",
      detectedAt: 0,
      fingerprint: "fingerprint-1",
    };
    const executor = createExecutor(entry, [detection]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode(FILE_CONTENTS).buffer,
      }),
    );

    const started = executor.install(entry.id, {});
    const final = await waitForTerminalStage(executor, started.id);

    expect(final.stage).toBe("done");
    expect(final.agentId).toBe("test-tool-agent");

    const written = await readFile(destination, "utf8");
    expect(written).toBe(FILE_CONTENTS);
    await unlink(destination);
  });

  it("rejects the download and leaves no file behind when the checksum does not match", async () => {
    const destination = join(tmpdir(), `chorus-installer-test-${randomUUID()}`);
    const entry = buildEntry(destination, "0".repeat(64));
    const executor = createExecutor(entry, []);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode(FILE_CONTENTS).buffer,
      }),
    );

    const started = executor.install(entry.id, {});
    const final = await waitForTerminalStage(executor, started.id);

    expect(final.stage).toBe("error");
    expect(final.error).toBe("CHECKSUM_MISMATCH");

    await expect(readFile(destination, "utf8")).rejects.toThrow();
  });
});
