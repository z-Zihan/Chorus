import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import type { AppConfig } from "@chorus/shared";
import { createJiti } from "jiti";

export function resolveAppDataDir(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Chorus");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA?.trim() || join(homedir(), "AppData", "Roaming"), "Chorus");
  }
  return join(process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share"), "chorus");
}

function defaultConfig(): AppConfig {
  return {
    host: "127.0.0.1",
    port: 3210,
    dbPath: join(resolveAppDataDir(), "chorus.db"),
    cors: {
      origin: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
      ],
    },
    auth: { enabled: false, tokens: {} },
    history: { maxMessages: 20, maxTokens: 8_000 },
    agents: [],
  };
}

function applyEnvOverrides(config: AppConfig): AppConfig {
  const host = process.env.SERVER_HOST?.trim() || config.host || "127.0.0.1";
  const envPort = Number.parseInt(process.env.SERVER_PORT ?? "", 10);
  const port =
    Number.isInteger(envPort) && envPort > 0 && envPort <= 65_535 ? envPort : config.port;
  const dbPath = process.env.SERVER_DB_PATH?.trim() || config.dbPath;
  const resolved = { ...config, host, port, dbPath };
  assertSafeNetworkConfig(resolved);
  return resolved;
}

export function assertSafeNetworkConfig(config: AppConfig): void {
  const host = config.host?.trim().toLowerCase() || "127.0.0.1";
  const loopback =
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/u.test(host);
  if (!loopback && !config.auth.enabled) {
    throw new Error(
      `Refusing to expose the Chorus API on ${host} while authentication is disabled. ` +
        "Enable auth and configure a client token, or bind SERVER_HOST to 127.0.0.1.",
    );
  }
}

function locateConfig(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), "chorus.config.ts"),
    resolve(process.cwd(), "../../chorus.config.ts"),
    resolve(here, "../../../chorus.config.ts"),
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
    return {
      config: applyEnvOverrides(defaults),
      rootDir: resolveAppDataDir(),
      source: "defaults",
    };
  }

  return loadConfigFile(configPath);
}
