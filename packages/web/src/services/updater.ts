import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

export const UPDATE_CHANNEL_STORAGE_KEY = "chorus-update-channel";
export const UPDATE_AVAILABLE_EVENT = "chorus:update-available";
export const UPDATE_ENDPOINT = import.meta.env.VITE_CHORUS_UPDATE_ENDPOINT?.trim() ?? "";

export type UpdateChannel = "stable" | "beta";
export type UpdateInfo = Update;
export type DownloadProgress = {
  downloaded: number;
  total: number | null;
  percent: number | null;
};

function isUpdateChannel(value: string | null): value is UpdateChannel {
  return value === "stable" || value === "beta";
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export function getUpdateChannel(): UpdateChannel {
  try {
    const channel = localStorage.getItem(UPDATE_CHANNEL_STORAGE_KEY);
    return isUpdateChannel(channel) ? channel : "stable";
  } catch {
    return "stable";
  }
}

export function setUpdateChannel(channel: UpdateChannel): boolean {
  try {
    localStorage.setItem(UPDATE_CHANNEL_STORAGE_KEY, channel);
    return true;
  } catch {
    return false;
  }
}

export function getUpdateEndpoint(channel = getUpdateChannel()): string {
  if (!UPDATE_ENDPOINT) return "";
  return `${UPDATE_ENDPOINT}?channel=${encodeURIComponent(channel)}`;
}

export function isUpdateConfigured(): boolean {
  return UPDATE_ENDPOINT.length > 0;
}

export function isUpdateSupported(): boolean {
  return isTauriRuntime() && isUpdateConfigured();
}

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  if (!isTauriRuntime() || !isUpdateConfigured()) return null;

  const channel = getUpdateChannel();
  const { check } = await import("@tauri-apps/plugin-updater");
  return check({
    // The configured endpoint carries the stable query parameter. These headers let the
    // release service honor a runtime beta selection without requiring an app rebuild.
    headers: {
      "X-Chorus-Update-Channel": channel,
      "X-Chorus-Update-Endpoint": getUpdateEndpoint(channel),
    },
  });
}

export function announceUpdate(update: UpdateInfo): void {
  window.dispatchEvent(new CustomEvent(UPDATE_AVAILABLE_EVENT, { detail: update }));
}

export async function downloadAndInstall(
  update: UpdateInfo,
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;

  const handleDownloadEvent = (event: DownloadEvent) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
      downloaded = 0;
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
    } else {
      downloaded = total ?? downloaded;
    }

    onProgress({
      downloaded,
      total,
      percent: total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null,
    });
  };

  await update.downloadAndInstall(handleDownloadEvent);
  onProgress({ downloaded: total ?? downloaded, total, percent: 100 });
}

export async function relaunchApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
