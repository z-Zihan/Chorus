import { unwatchFile, watchFile, type Stats } from "node:fs";
import type { AppConfig } from "@chorus/shared";
import { loadConfigFile } from "./config.js";

export type ConfigChangeCallback = (config: AppConfig) => void | Promise<void>;

export class ConfigWatcher {
  private debounceTimer?: NodeJS.Timeout;
  private destroyed = false;

  constructor(
    readonly path: string,
    private readonly callback: ConfigChangeCallback,
    private readonly onError?: (error: unknown) => void,
    private readonly debounceMs = 500,
  ) {
    watchFile(this.path, { interval: 250 }, this.handleFileChange);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    unwatchFile(this.path, this.handleFileChange);
  }

  private readonly handleFileChange = (current: Stats, previous: Stats): void => {
    if (this.destroyed || current.mtimeMs === previous.mtimeMs) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.reload();
    }, this.debounceMs);
  };

  private async reload(): Promise<void> {
    try {
      const { config } = await loadConfigFile(this.path);
      await this.callback(config);
    } catch (error) {
      this.onError?.(error);
    }
  }
}
