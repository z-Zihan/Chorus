import { create } from "zustand";
import type { CatalogEntryWithStatus, InstallationStatus, InstallOptions } from "@chorus/shared";
import { api } from "@/services/api";
import { useAgentStore } from "@/store/agentStore";
import { useUIStore } from "@/store/uiStore";
import i18n from "@/i18n";
import { logger } from "@/utils/logger";

/** The catalog listing is always served with install/detect status attached. */
export type CatalogEntry = CatalogEntryWithStatus;
export type { InstallationStatus, InstallOptions };

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
/** Bumped on every install/cancel so in-flight poll responses from an older run are dropped. */
let pollGeneration = 0;
/** Consecutive getInstallation failures tolerated before polling gives up. */
const MAX_POLL_FAILURES = 3;

function stopPolling(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = undefined;
  pollGeneration += 1;
}

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
    stopPolling();
    const generation = pollGeneration;

    // A failed post-install refresh must not turn a successful install into a failure.
    const finishInstall = async (agentId: string | undefined): Promise<void> => {
      try {
        await Promise.all([get().fetchCatalog(), useAgentStore.getState().fetchAgents()]);
      } catch (error) {
        logger.error("Failed to refresh after catalog install", error);
      }
      if (agentId) useAgentStore.getState().selectAgent(agentId);
      useUIStore.getState().addToast(i18n.t("catalog.success"), "success");
    };

    let installation: InstallationStatus;
    try {
      installation = await api.installCatalogEntry(entryId, options);
    } catch (error) {
      logger.error("Failed to install catalog entry", error);
      if (generation === pollGeneration) set({ installation: null });
      return;
    }
    if (generation !== pollGeneration) return;
    set({ installation });

    const isCurrent = (): boolean =>
      generation === pollGeneration && get().installation?.id === installation.id;

    let failures = 0;
    const poll = async (): Promise<void> => {
      if (!isCurrent()) return;
      let next: InstallationStatus;
      try {
        next = await api.getInstallation(installation.id);
      } catch (error) {
        if (!isCurrent()) return;
        failures += 1;
        logger.error("Failed to poll catalog installation", error);
        if (failures >= MAX_POLL_FAILURES) {
          useUIStore.getState().addToast(i18n.t("catalog.failed"), "error");
          return;
        }
        pollTimer = setTimeout(() => void poll(), 500);
        return;
      }
      if (!isCurrent()) return;
      failures = 0;
      set({ installation: next });
      if (next.stage === "done") {
        await finishInstall(next.agentId);
        return;
      }
      if (next.stage === "error") {
        useUIStore.getState().addToast(i18n.t("catalog.failed"), "error");
        return;
      }
      pollTimer = setTimeout(() => void poll(), 500);
    };

    if (installation.stage === "done") {
      await finishInstall(installation.agentId);
    } else {
      pollTimer = setTimeout(() => void poll(), 300);
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
    stopPolling();
    const cancelled = await api.cancelInstallation(installation.id);
    set({ installation: cancelled });
  },
}));
