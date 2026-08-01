/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WS_BASE_URL?: string;
  readonly VITE_DEFAULT_THEME?: "dark" | "light" | "system";
  readonly VITE_DEFAULT_LANG?: "zh-CN" | "en";
  readonly VITE_ANALYTICS_PROVIDER?: "console" | "noop" | "sentry";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
