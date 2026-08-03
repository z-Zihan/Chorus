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
  fetchPlugins: () => Promise<void>;
}

export const usePluginStore = create<PluginState>((set) => ({
  plugins: [],
  isLoading: false,

  fetchPlugins: async () => {
    set({ isLoading: true });
    try {
      const plugins = await api.getPlugins();
      set({ plugins, isLoading: false });
    } catch (e) {
      logger.error("Failed to fetch plugins", e);
      set({ isLoading: false });
    }
  },
}));
