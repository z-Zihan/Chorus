import { create } from "zustand";
import { api } from "@/services/api";
import { useAgentStore } from "@/store/agentStore";
import { useUIStore } from "@/store/uiStore";
import i18n from "@/i18n";
import { logger } from "@/utils/logger";

export type CatalogKind = "detected-cli" | "managed-cli" | "api-connector";
export type InstallMethod = "brew" | "npm" | "winget" | "download" | "pip";

export interface InstallRecipe {
  method: InstallMethod;
  executable: string;
  args: string[];
  requiresElevation: boolean;
}

export interface CatalogEntry {
  id: string;
  name: string;
  summary: string;
  publisher: { name: string; url: string; verified: boolean };
  kind: CatalogKind;
  platforms: string[];
  capabilities: string[];
  permissions: string[];
  homepage: string;
  license: string;
  descriptorId?: string;
  installRecipes: InstallRecipe[];
  uninstallRecipes: InstallRecipe[];
  adapterTemplate: { type: "cli" | "openai"; config: Record<string, unknown> };
  installed: boolean;
  detected?: boolean;
  agentId?: string;
  disabled?: boolean;
}

export interface InstallOptions {
  recipeMethod?: InstallMethod;
  apiKey?: string;
  config?: Record<string, unknown>;
  acceptPermissions?: boolean;
}

export interface InstallationStatus {
  id: string;
  entryId: string;
  stage: "checking" | "downloading" | "installing" | "verifying" | "done" | "error";
  progress: number;
  command?: string;
  agentId?: string;
  error?: string;
  cancelled?: boolean;
  startedAt: number;
  updatedAt: number;
}

interface CatalogState {
  entries: CatalogEntry[];
  selectedEntry: CatalogEntry | null;
  installation: InstallationStatus | null;
  isLoading: boolean;
  loadError: boolean;
  fetchCatalog: () => Promise<void>;
  selectEntry: (entry: CatalogEntry | null) => void;
  installAgent: (entryId: string, options?: InstallOptions) => Promise<void>;
  adoptDetectedAgent: (descriptorId: string) => Promise<void>;
  cancelInstall: () => Promise<void>;
}

let pollTimer: ReturnType<typeof setTimeout> | undefined;

export const useCatalogStore = create<CatalogState>((set, get) => ({
  entries: [],
  selectedEntry: null,
  installation: null,
  isLoading: false,
  loadError: false,

  fetchCatalog: async () => {
    set({ isLoading: true, loadError: false });
    try {
      const entries = await api.getCatalog(true);
      set((state) => ({
        entries,
        selectedEntry: state.selectedEntry
          ? (entries.find((entry) => entry.id === state.selectedEntry?.id) ?? null)
          : null,
        isLoading: false,
        loadError: false,
      }));
    } catch (error) {
      logger.error("Failed to fetch catalog", error);
      set({ isLoading: false, loadError: true });
    }
  },

  selectEntry: (selectedEntry) => set({ selectedEntry, installation: null }),

  installAgent: async (entryId, options = {}) => {
    if (pollTimer) clearTimeout(pollTimer);
    try {
      const installation = await api.installCatalogEntry(entryId, options);
      set({ installation });

      const poll = async (): Promise<void> => {
        const current = get().installation;
        if (!current || current.id !== installation.id) return;
        const next = await api.getInstallation(installation.id);
        set({ installation: next });
        if (next.stage === "done") {
          await Promise.all([get().fetchCatalog(), useAgentStore.getState().fetchAgents()]);
          if (next.agentId) useAgentStore.getState().selectAgent(next.agentId);
          useUIStore.getState().addToast(i18n.t("catalog.success"), "success");
          return;
        }
        if (next.stage === "error") {
          useUIStore.getState().addToast(i18n.t("catalog.failed"), "error");
          return;
        }
        pollTimer = setTimeout(() => void poll(), 500);
      };

      if (installation.stage === "done") {
        await Promise.all([get().fetchCatalog(), useAgentStore.getState().fetchAgents()]);
        if (installation.agentId) useAgentStore.getState().selectAgent(installation.agentId);
        useUIStore.getState().addToast(i18n.t("catalog.success"), "success");
      } else {
        pollTimer = setTimeout(() => void poll(), 300);
      }
    } catch (error) {
      logger.error("Failed to install catalog entry", error);
      set({ installation: null });
    }
  },

  adoptDetectedAgent: async (descriptorId: string) => {
    try {
      const detections = await api.getCliDetections();
      const detection = detections.find((d) => d.descriptorId === descriptorId);
      if (!detection) {
        useUIStore.getState().addToast(i18n.t("catalog.notDetected"), "error");
        return;
      }
      const agent = await api.adoptDetection(detection.id);
      try {
        await api.getAgent(agent.id, true);
      } catch (error) {
        logger.error("Added agent could not be verified", error);
        useUIStore.getState().addToast(i18n.t("catalog.verificationFailed"), "error");
        await Promise.all([get().fetchCatalog(), useAgentStore.getState().fetchAgents()]);
        return;
      }
      await Promise.all([get().fetchCatalog(), useAgentStore.getState().fetchAgents()]);
      useAgentStore.getState().selectAgent(agent.id);
      useUIStore.getState().addToast(i18n.t("catalog.added"), "success");
      set({ selectedEntry: null });
    } catch (error) {
      logger.error("Failed to adopt detected agent", error);
      useUIStore.getState().addToast(i18n.t("catalog.failed"), "error");
    }
  },

  cancelInstall: async () => {
    const installation = get().installation;
    if (!installation || installation.stage === "done" || installation.stage === "error") return;
    if (pollTimer) clearTimeout(pollTimer);
    const cancelled = await api.cancelInstallation(installation.id);
    set({ installation: cancelled });
  },
}));
