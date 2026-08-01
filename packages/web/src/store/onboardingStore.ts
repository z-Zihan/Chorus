import { create } from "zustand";
import type { OnboardingStatus } from "@agentlink/shared";
import { api } from "@/services/api";
import { logger } from "@/utils/logger";

interface OnboardingState {
  status: OnboardingStatus | null;
  isLoading: boolean;

  checkStatus: () => Promise<void>;
  rescan: () => Promise<void>;
  selectAgent: (detectionId: string) => Promise<void>;
  complete: () => Promise<void>;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  status: null,
  isLoading: false,

  checkStatus: async () => {
    set({ isLoading: true });
    try {
      const status = await api.getOnboardingStatus();
      set({ status, isLoading: false });
    } catch (e) {
      logger.error("Failed to check onboarding status", e);
      set({ isLoading: false });
    }
  },

  rescan: async () => {
    set({ isLoading: true });
    try {
      const status = await api.rescanOnboarding();
      set({ status, isLoading: false });
    } catch (e) {
      logger.error("Failed to rescan", e);
      set({ isLoading: false });
    }
  },

  selectAgent: async (detectionId: string) => {
    set({ isLoading: true });
    try {
      const status = await api.selectOnboardingAgent(detectionId);
      set({ status, isLoading: false });
    } catch (e) {
      logger.error("Failed to select agent", e);
      set({ isLoading: false });
    }
  },

  complete: async () => {
    try {
      const status = await api.completeOnboarding();
      set({ status });
    } catch (e) {
      logger.error("Failed to complete onboarding", e);
    }
  },
}));
