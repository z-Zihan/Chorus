import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "@agentlink/shared";
import { createJiti } from "jiti";

const defaults: AppConfig = {
  port: 3210,
  dbPath: "./data/agentlink.db",
  cors: { origin: ["http://localhost:5173", "http://127.0.0.1:5173"] },
  auth: { enabled: false },
  history: { maxMessages: 20, maxTokens: 8_000 },
  agents: [],
};

function locateConfig(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), "agentlink.config.ts"),
    resolve(process.cwd(), "../../agentlink.config.ts"),
    resolve(here, "../../../agentlink.config.ts"),
  ];
  return candidates.find(existsSync);
}

export async function loadConfig(): Promise<{ config: AppConfig; rootDir: string }> {
  const configPath = locateConfig();
  if (!configPath) return { config: defaults, rootDir: process.cwd() };

  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const userConfig = (await jiti.import(configPath, { default: true })) as Partial<AppConfig>;
  const config: AppConfig = {
    ...defaults,
    ...userConfig,
    cors: { ...defaults.cors, ...userConfig.cors },
    auth: { ...defaults.auth, ...userConfig.auth },
    history: { ...defaults.history, ...userConfig.history },
    agents: userConfig.agents ?? defaults.agents,
  };
  return { config, rootDir: dirname(configPath) };
}
