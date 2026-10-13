import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PluginLoader } from "../loader.js";

let temporaryDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "chorus-plugins-"));
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

async function writePlugin(
  name: string,
  manifest: Record<string, unknown>,
  entrySource = `export default { async init() {} };`,
) {
  const directory = join(temporaryDirectory, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "plugin.json"), JSON.stringify(manifest), "utf8");
  await writeFile(join(directory, "index.js"), entrySource, "utf8");
}

describe("PluginLoader", () => {
  it("loads a valid plugin and lists it", async () => {
    await writePlugin("valid", {
      name: "valid-plugin",
      version: "1.0.0",
      description: "A valid plugin",
      type: "extension",
      entry: "index.js",
      permissions: [],
    });

    const loader = new PluginLoader();
    const manifests = await loader.loadPlugins(temporaryDirectory);

    expect(manifests).toHaveLength(1);
    expect(manifests[0]).toMatchObject({ name: "valid-plugin", version: "1.0.0" });
    expect(loader.loadErrors).toHaveLength(0);
  });

  it("skips a plugin with a duplicate name and records the conflict", async () => {
    await writePlugin("first", {
      name: "dup-plugin",
      version: "1.0.0",
      description: "First plugin",
      type: "extension",
      entry: "index.js",
      permissions: [],
    });
    await writePlugin("second", {
      name: "dup-plugin",
      version: "2.0.0",
      description: "Second plugin claiming the same name",
      type: "extension",
      entry: "index.js",
      permissions: [],
    });

    const loader = new PluginLoader();
    const manifests = await loader.loadPlugins(temporaryDirectory);

    expect(manifests).toHaveLength(1);
    expect(manifests[0]?.version).toBe("1.0.0");
    expect(loader.loadErrors).toHaveLength(1);
    expect(loader.loadErrors[0]?.error).toBe("Duplicate plugin name: dup-plugin");
    expect(loader.loadErrors[0]?.manifestPath).toContain("second");
  });

  it("skips an invalid manifest missing a version and records the error", async () => {
    await writePlugin("invalid", {
      name: "invalid-plugin",
      description: "Missing version field",
      type: "extension",
      entry: "index.js",
      permissions: [],
    });

    const loader = new PluginLoader();
    const manifests = await loader.loadPlugins(temporaryDirectory);

    expect(manifests).toHaveLength(0);
    expect(loader.loadErrors).toHaveLength(1);
    expect(loader.loadErrors[0]?.error).toContain("Invalid plugin manifest");
  });
});
