// Detect whether we're running inside Tauri's webview
let _isTauri: boolean | null = null;

export function isTauri(): boolean {
  if (_isTauri !== null) return _isTauri;
  _isTauri =
    typeof window !== "undefined" &&
    (window.__TAURI_INTERNALS__ !== undefined ||
      window.__TAURI__ !== undefined);
  return _isTauri;
}

export function getApiBaseUrl(): string {
  if (isTauri()) {
    return "http://localhost:3210/api";
  }
  return "/api";
}

export function getWsUrl(): string {
  if (isTauri()) {
    return "ws://localhost:3210/ws";
  }
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}
