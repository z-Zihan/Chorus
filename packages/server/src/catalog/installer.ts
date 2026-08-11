import { logger } from "../utils/logger.js";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import type { PersistedAgentConfig } from "@chorus/shared";
import type { AgentRegistry } from "../agent/registry.js";
import type { CliDetector } from "../cli-detector/index.js";
import type { CatalogService } from "./index.js";
import type { CatalogEntry, InstallRecipe } from "./schema.js";
import { setCredential } from "../credential-store.js";

export type InstallationStage =
  | "checking"
  | "downloading"
  | "installing"
  | "verifying"
  | "done"
  | "error";

export interface InstallOptions {
  recipeMethod?: InstallRecipe["method"];
  apiKey?: string;
  config?: Record<string, unknown>;
  acceptPermissions?: boolean;
}

export interface InstallationStatus {
  id: string;
  entryId: string;
  stage: InstallationStage;
  progress: number;
  command?: string;
  agentId?: string;
  error?: string;
  cancelled?: boolean;
  startedAt: number;
  updatedAt: number;
}

interface RunningInstallation {
  status: InstallationStatus;
  controller: AbortController;
}

const INSTALL_TIMEOUT_MS = 120_000;

export class InstallExecutor extends EventEmitter {
  private readonly installations = new Map<string, RunningInstallation>();

  constructor(
    private readonly catalog: CatalogService,
    private readonly registry: AgentRegistry,
    private readonly detector: CliDetector,
  ) {
    super();
  }

  install(entryId: string, options: InstallOptions = {}): InstallationStatus {
    const entry = this.catalog.getCached(entryId);
    if (!entry) throw new Error("CATALOG_ENTRY_NOT_FOUND");
    this.validateEntry(entry, options);

    const existing = this.catalog.getCached(entryId);
    if (existing?.installed && existing.agentId) {
      return {
        id: randomUUID(),
        entryId,
        stage: "done",
        progress: 100,
        agentId: existing.agentId,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    const id = randomUUID();
    const running: RunningInstallation = {
      controller: new AbortController(),
      status: {
        id,
        entryId,
        stage: "checking",
        progress: 5,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      },
    };
    this.installations.set(id, running);
    this.emitProgress(running);
    void this.run(entry, options, running);
    return { ...running.status };
  }

  get(id: string): InstallationStatus | undefined {
    const installation = this.installations.get(id);
    return installation ? { ...installation.status } : undefined;
  }

  cancel(id: string): InstallationStatus | undefined {
    const installation = this.installations.get(id);
    if (!installation) return undefined;
    if (installation.status.stage !== "done" && installation.status.stage !== "error") {
      installation.controller.abort();
      this.update(installation, "error", installation.status.progress, {
        cancelled: true,
        error: "INSTALLATION_CANCELLED",
      });
    }
    return { ...installation.status };
  }

  validateEntry(entry: CatalogEntry, options: InstallOptions = {}): void {
    const platform = process.platform === "darwin" || process.platform === "win32"
      ? process.platform
      : "linux";
    if (!entry.platforms.includes(platform)) {
      logger.error({ entryId: entry.id, platform }, "Platform not supported");
      throw new Error("PLATFORM_NOT_SUPPORTED");
    }
    if (entry.permissions.length > 0 && options.acceptPermissions !== true) {
      logger.error({ entryId: entry.id }, "Permissions not accepted");
      throw new Error("PERMISSIONS_NOT_ACCEPTED");
    }
    if (entry.kind === "api-connector" && !options.apiKey?.trim()) {
      throw new Error("API_KEY_REQUIRED");
    }
    if (entry.kind !== "api-connector" && entry.installRecipes.length === 0) {
      logger.error({ entryId: entry.id, kind: entry.kind }, "No install recipe found");
      throw new Error("INSTALL_RECIPE_NOT_FOUND");
    }
  }

  private async run(
    entry: CatalogEntry,
    options: InstallOptions,
    installation: RunningInstallation,
  ): Promise<void> {
    const timeout = setTimeout(() => installation.controller.abort(), INSTALL_TIMEOUT_MS);
    let recipe: InstallRecipe | undefined;
    let installStarted = false;
    try {
      if (entry.kind === "api-connector") {
        this.update(installation, "installing", 55);
        const agent = await this.createApiAgent(entry, options);
        this.update(installation, "verifying", 90);
        this.update(installation, "done", 100, { agentId: agent.id });
        return;
      }

      recipe = selectRecipe(entry, options.recipeMethod);
      await this.checkRecipe(recipe, installation.controller.signal);
      this.update(installation, "downloading", 25, {
        command: formatCommand(recipe),
      });
      installStarted = true;
      if (recipe.method !== "download") this.update(installation, "installing", 40);
      await this.executeRecipe(recipe, installation.controller.signal);
      if (recipe.method === "download") this.update(installation, "installing", 65);
      this.update(installation, "verifying", 85);
      const agentId = await this.verifyAndAdopt(entry, installation.controller.signal);
      this.update(installation, "done", 100, { agentId });
    } catch (error) {
      if (installStarted && recipe) await this.rollback(entry, recipe);
      const cancelled = installation.controller.signal.aborted;
      this.update(installation, "error", installation.status.progress, {
        cancelled,
        error: cancelled ? "INSTALLATION_CANCELLED_OR_TIMED_OUT" : errorMessage(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async createApiAgent(entry: CatalogEntry, options: InstallOptions) {
    const id = availableAgentId(entry.id, this.registry);
    const agent = await this.registry.registerAndPersist({
      id,
      name: entry.name,
      description: entry.summary,
      type: entry.adapterTemplate.type,
      config: {
        ...entry.adapterTemplate.config,
        ...options.config,
        apiKey: options.apiKey?.trim(),
      },
      source: "catalog",
      managed: true,
      customizedFields: [],
      catalogEntryId: entry.id,
      capabilities: entry.capabilities,
      disabled: false,
    } satisfies PersistedAgentConfig);
    const apiKey = options.apiKey?.trim();
    if (apiKey) await setCredential(agent.id, apiKey);
    return agent;
  }

  private async verifyAndAdopt(entry: CatalogEntry, signal: AbortSignal): Promise<string> {
    const detections = await this.detector.forceRescan(signal);
    const detection = detections.find((candidate) => candidate.descriptorId === entry.descriptorId);
    if (!detection || detection.status === "error" || detection.status === "unsupported") {
      throw new Error(detection?.diagnosticsCode ?? "CLI_VERIFICATION_FAILED");
    }
    const id = availableAgentId(entry.id, this.registry);
    const agent = await this.registry.registerAndPersist({
      id,
      name: entry.name,
      description: entry.summary,
      type: "cli",
      config: {
        ...entry.adapterTemplate.config,
        command: detection.resolvedPath,
      },
      source: "catalog",
      managed: true,
      customizedFields: [],
      catalogEntryId: entry.id,
      capabilities: entry.capabilities,
      detectionFingerprint: detection.fingerprint,
      disabled: false,
    } satisfies PersistedAgentConfig);
    return agent.id;
  }

  private async checkRecipe(recipe: InstallRecipe, signal: AbortSignal): Promise<void> {
    if (recipe.requiresElevation) throw new Error("ELEVATION_REQUIRED");
    if (recipe.method === "download") {
      new URL(recipe.executable);
      return;
    }
    if (recipe.method === "brew" && process.platform === "win32") throw new Error("METHOD_NOT_SUPPORTED");
    if (recipe.method === "winget" && process.platform !== "win32") throw new Error("METHOD_NOT_SUPPORTED");
    if (recipe.method === "pip" && recipe.executable !== "pip" && recipe.executable !== "pip3") {
      throw new Error("METHOD_NOT_SUPPORTED");
    }
    await runCommand(recipe.executable, ["--version"], signal, 10_000);
  }

  private async executeRecipe(recipe: InstallRecipe, signal: AbortSignal): Promise<void> {
    if (recipe.method !== "download") {
      await runCommand(recipe.executable, recipe.args, signal, INSTALL_TIMEOUT_MS);
      return;
    }
    const response = await fetch(recipe.executable, { signal });
    if (!response.ok) throw new Error(`DOWNLOAD_FAILED_${response.status}`);
    const destination = recipe.args[0] || join(tmpdir(), basename(new URL(recipe.executable).pathname));
    await writeFile(destination, Buffer.from(await response.arrayBuffer()));
    if (process.platform !== "win32") await chmod(destination, 0o755);
  }

  private async rollback(entry: CatalogEntry, installedWith: InstallRecipe): Promise<void> {
    const recipe = entry.uninstallRecipes.find(
      (candidate) => candidate.method === installedWith.method,
    );
    try {
      if (installedWith.method === "download") {
        const destination = recipe?.args[0] ?? installedWith.args[0];
        if (destination) await unlink(destination);
        return;
      }
      if (!recipe) return;
      await runCommand(recipe.executable, recipe.args, undefined, 30_000);
    } catch {
      // Preserve the original installation error if rollback also fails.
    }
  }

  private update(
    installation: RunningInstallation,
    stage: InstallationStage,
    progress: number,
    extra: Partial<InstallationStatus> = {},
  ): void {
    installation.status = {
      ...installation.status,
      ...extra,
      stage,
      progress,
      updatedAt: Date.now(),
    };
    this.emitProgress(installation);
  }

  private emitProgress(installation: RunningInstallation): void {
    this.emit("progress", { ...installation.status });
  }
}

function selectRecipe(entry: CatalogEntry, requested?: InstallRecipe["method"]): InstallRecipe {
  const recipe = requested
    ? entry.installRecipes.find((candidate) => candidate.method === requested)
    : entry.installRecipes.find((candidate) =>
        process.platform === "darwin" ? candidate.method === "brew" :
          process.platform === "win32" ? candidate.method === "winget" :
            candidate.method === "npm",
      ) ?? entry.installRecipes[0];
  if (!recipe) throw new Error("INSTALL_RECIPE_NOT_FOUND");
  return recipe;
}

function formatCommand(recipe: InstallRecipe): string {
  return [recipe.executable, ...recipe.args].map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return /^[a-zA-Z0-9_@%+=:,./-]+$/u.test(value) ? value : JSON.stringify(value);
}

function runCommand(
  executable: string,
  args: string[],
  signal?: AbortSignal,
  timeoutMs = INSTALL_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("INSTALLATION_CANCELLED"));
      return;
    }
    let stderr = "";
    let settled = false;
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => {
      child.kill("SIGTERM");
      finish(new Error("INSTALLATION_CANCELLED"));
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("COMMAND_TIMED_OUT"));
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2_000);
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(stderr.trim() || `COMMAND_FAILED_${code ?? "UNKNOWN"}`));
    });
  });
}

function availableAgentId(baseId: string, registry: AgentRegistry): string {
  if (!registry.get(baseId, true)) return baseId;
  let suffix = 2;
  while (registry.get(`${baseId}-${suffix}`, true)) suffix += 1;
  return `${baseId}-${suffix}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
