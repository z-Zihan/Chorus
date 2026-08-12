import { create } from "zustand";
import type { OnboardingStatus } from "@chorus/shared";
import { api } from "@/services/api";
import { logger } from "@/utils/logger";
import i18n from "@/i18n";

type OnboardingAction = "load" | "rescan" | "select";
const STARTUP_ATTEMPTS = 10;
const STARTUP_RETRY_MS = 350;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

interface OnboardingState {
  status: OnboardingStatus | null;
  isLoading: boolean;
  pendingAction: OnboardingAction | null;
  loadError: string | null;
  actionError: string | null;

  checkStatus: () => Promise<void>;
  rescan: () => Promise<void>;
  selectAgent: (detectionId: string) => Promise<void>;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  status: null,
  isLoading: false,
  pendingAction: null,
  loadError: null,
  actionError: null,

  checkStatus: async () => {
    if (get().pendingAction) return;
    set({ isLoading: true, pendingAction: "load", loadError: null });
    let lastError: unknown;
    for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt += 1) {
      try {
        const status = await api.getOnboardingStatus();
        set({ status, isLoading: false, pendingAction: null, loadError: null });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < STARTUP_ATTEMPTS - 1) await wait(STARTUP_RETRY_MS);
      }
    }
    logger.error("Failed to check onboarding status", lastError);
    set({
      isLoading: false,
      pendingAction: null,
      loadError: i18n.t("common:onboarding.loadFailed"),
    });
  },

  rescan: async () => {
    if (get().pendingAction) return;
    set({ isLoading: true, pendingAction: "rescan", actionError: null, loadError: null });
    try {
      const status = await api.rescanOnboarding();
      set({ status, isLoading: false, pendingAction: null, actionError: null });
    } catch (e) {
      logger.error("Failed to rescan", e);
      set({
        isLoading: false,
        pendingAction: null,
        actionError: i18n.t("common:onboarding.rescanFailed"),
      });
    }
  },

  selectAgent: async (detectionId: string) => {
    if (get().pendingAction) return;
    set({ isLoading: true, pendingAction: "select", actionError: null, loadError: null });
    try {
      const status = await api.selectOnboardingAgent(detectionId);
      set({ status, isLoading: false, pendingAction: null, actionError: null });
    } catch (e) {
      logger.error("Failed to select agent", e);
      set({
        isLoading: false,
        pendingAction: null,
        actionError: i18n.t("common:onboarding.startFailed"),
      });
    }
  },
}));
