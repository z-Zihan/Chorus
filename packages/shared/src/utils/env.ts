type RuntimeImportMeta = ImportMeta & {
  env?: {
    DEV?: boolean;
    PROD?: boolean;
    MODE?: string;
  };
};

type RuntimeGlobal = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
  window?: {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
};

function runtimeMode(): string | undefined {
  const viteEnv = (import.meta as RuntimeImportMeta).env;
  if (viteEnv?.MODE) return viteEnv.MODE;
  return (globalThis as RuntimeGlobal).process?.env?.NODE_ENV;
}

export function isDev(): boolean {
  const viteEnv = (import.meta as RuntimeImportMeta).env;
  return viteEnv?.DEV ?? runtimeMode() === "development";
}

export function isProd(): boolean {
  const viteEnv = (import.meta as RuntimeImportMeta).env;
  return viteEnv?.PROD ?? runtimeMode() === "production";
}

export function isTest(): boolean {
  return runtimeMode() === "test";
}

export function isTauri(): boolean {
  const runtimeWindow = (globalThis as RuntimeGlobal).window;
  return Boolean(
    runtimeWindow?.__TAURI_INTERNALS__ !== undefined ||
      runtimeWindow?.__TAURI__ !== undefined
  );
}
