import { create } from "zustand";
import { api } from "@/services/api";
import { logger } from "@/utils/logger";

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  type: "adapter" | "extension";
  permissions: string[];
}

interface PluginState {
  plugins: PluginInfo[];
  isLoading: boolean;
  loadError: boolean;
  fetchPlugins: () => Promise<void>;
}

export const usePluginStore = create<PluginState>((set) => ({
  plugins: [],
  isLoading: false,
  loadError: false,

  fetchPlugins: async () => {
    set({ isLoading: true, loadError: false });
    try {
      const plugins = await api.getPlugins(true);
      set({ plugins, isLoading: false, loadError: false });
    } catch (e) {
      logger.error("Failed to fetch plugins", e);
      set({ isLoading: false, loadError: true });
    }
  },
}));
