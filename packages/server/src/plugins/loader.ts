import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { logger } from "../utils/logger.js";
import type { PluginContext, PluginInterface, PluginManifest } from "./types.js";

interface LoadedPlugin {
  manifest: PluginManifest;
  plugin: PluginInterface;
  directory: string;
  initialized: boolean;
}

export class PluginLoader {
  private readonly plugins: LoadedPlugin[] = [];
  /** Manifests that failed to load and were skipped so startup can continue. */
  readonly loadErrors: { manifestPath: string; error: string }[] = [];

  async loadPlugins(pluginDir: string): Promise<PluginManifest[]> {
    this.plugins.length = 0;
    this.loadErrors.length = 0;
    if (!existsSync(pluginDir)) return [];
    const manifests = await findManifestFiles(resolve(pluginDir));
    for (const manifestPath of manifests) {
      // A single broken plugin must not take the whole backend down: skip it,
      // record the failure, and keep loading the remaining plugins.
      try {
        this.plugins.push(await this.loadPlugin(manifestPath));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.loadErrors.push({ manifestPath, error: reason });
        logger.warn({ manifestPath, err: error }, "Skipping invalid plugin manifest");
      }
    }
    return this.listLoaded();
  }

  private async loadPlugin(manifestPath: string): Promise<LoadedPlugin> {
    const raw = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    if (!this.validateManifest(raw)) {
      throw new Error(`Invalid plugin manifest: ${manifestPath}`);
    }
    const directory = dirname(manifestPath);
    const entryPath = resolve(directory, raw.entry);
    const entryRelative = relative(directory, entryPath);
    if (entryRelative.startsWith("..") || entryRelative.includes("..")) {
      throw new Error(`Plugin entry must stay inside its directory: ${raw.name}`);
    }
    const module = (await import(`${pathToFileURL(entryPath).href}?v=${Date.now()}`)) as Record<
      string,
      unknown
    >;
    const plugin = (module.default ?? module.plugin) as Partial<PluginInterface> | undefined;
    if (!plugin || typeof plugin.init !== "function") {
      throw new Error(`Plugin ${raw.name} does not export a valid PluginInterface`);
    }
    return {
      manifest: raw,
      plugin: plugin as PluginInterface,
      directory,
      initialized: false,
    };
  }

  listLoaded(): PluginManifest[] {
    return this.plugins.map(({ manifest }) => ({
      ...manifest,
      permissions: [...manifest.permissions],
    }));
  }

  validateManifest(manifest: unknown): manifest is PluginManifest {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return false;
    const value = manifest as Record<string, unknown>;
    return (
      typeof value.name === "string" &&
      value.name.trim().length > 0 &&
      typeof value.version === "string" &&
      value.version.trim().length > 0 &&
      typeof value.description === "string" &&
      (value.type === "adapter" || value.type === "extension") &&
      typeof value.entry === "string" &&
      value.entry.trim().length > 0 &&
      Array.isArray(value.permissions) &&
      value.permissions.every((permission) => typeof permission === "string")
    );
  }

  async initPlugins(context: PluginContext): Promise<void> {
    for (const loaded of this.plugins) {
      if (loaded.initialized) continue;
      await loaded.plugin.init(context);
      loaded.initialized = true;
    }
  }

  destroyPlugins(): void {
    for (const loaded of [...this.plugins].reverse()) {
      if (!loaded.initialized) continue;
      loaded.plugin.destroy?.();
      loaded.initialized = false;
    }
  }
}

async function findManifestFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const manifests: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) manifests.push(...(await findManifestFiles(path)));
    else if (entry.isFile() && entry.name === "plugin.json") manifests.push(path);
  }
  return manifests.sort();
}
