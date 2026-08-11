export { isDev, isProd, isTauri, isTest } from "@chorus/shared";

export function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL || "/api";
}

export function getWsUrl(): string {
  return import.meta.env.VITE_WS_BASE_URL || "ws://localhost:3210/ws";
}
