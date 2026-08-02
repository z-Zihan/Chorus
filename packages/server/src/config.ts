import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import type { AppConfig } from "@agentlink/shared";
import { createJiti } from "jiti";

export function resolveAppDataDir(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "AgentLink");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA?.trim() || join(homedir(), "AppData", "Roaming"), "AgentLink");
  }
  return join(process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share"), "agentlink");
}

function defaultConfig(): AppConfig {
  return {
    port: 3210,
    dbPath: join(resolveAppDataDir(), "agentlink.db"),
    cors: { origin: ["http://localhost:5173", "http://127.0.0.1:5173"] },
    auth: { enabled: false, tokens: {} },
    history: { maxMessages: 20, maxTokens: 8_000 },
    agents: [],
  };
}

function applyEnvOverrides(config: AppConfig): AppConfig {
  const envPort = Number.parseInt(process.env.SERVER_PORT ?? "", 10);
  const port = Number.isInteger(envPort) && envPort > 0 && envPort <= 65_535
    ? envPort
    : config.port;
  const dbPath = process.env.SERVER_DB_PATH?.trim() || config.dbPath;
  return { ...config, port, dbPath };
}

function locateConfig(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), "agentlink.config.ts"),
    resolve(process.cwd(), "../../agentlink.config.ts"),
    resolve(here, "../../../agentlink.config.ts"),
  ];
  return candidates.find(existsSync);
}

export function hasExistingConfig(): boolean {
  return locateConfig() !== undefined;
}

export type LoadedConfig = {
  config: AppConfig;
  rootDir: string;
  source: "explicit_config" | "defaults";
};

export async function loadConfigFile(configPath: string): Promise<LoadedConfig> {
  const defaults = defaultConfig();
  const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
  const userConfig = (await jiti.import(configPath, { default: true })) as Partial<AppConfig>;
  const config: AppConfig = {
    ...defaults,
    ...userConfig,
    cors: { ...defaults.cors, ...userConfig.cors },
    auth: { ...defaults.auth, ...userConfig.auth },
    history: { ...defaults.history, ...userConfig.history },
    agents: userConfig.agents ?? defaults.agents,
  };
  return {
    config: applyEnvOverrides(config),
    rootDir: dirname(configPath),
    source: "explicit_config",
  };
}

export async function loadConfig(): Promise<LoadedConfig> {
  const defaults = defaultConfig();
  const configPath = locateConfig();
  if (!configPath) {
    return { config: applyEnvOverrides(defaults), rootDir: process.cwd(), source: "defaults" };
  }

  return loadConfigFile(configPath);
}
