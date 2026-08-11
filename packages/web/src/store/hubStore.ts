import type { HubConnectionState } from "@chorus/shared";
import { create } from "zustand";
import { api, type HubPeerStatus } from "@/services/api";
import { logger } from "@/utils/logger";

interface HubState {
  hubConnectionState: HubConnectionState;
  peers: HubPeerStatus[];
  fetchHubStatus: () => Promise<void>;
}

export const useHubStore = create<HubState>((set) => ({
  hubConnectionState: "disconnected",
  peers: [],

  fetchHubStatus: async () => {
    try {
      const status = await api.getHubStatus();
      set({
        hubConnectionState: status.relayState,
        peers: status.peers,
      });
    } catch (error) {
      logger.error("Failed to fetch Hub status", error);
      set({ hubConnectionState: "error", peers: [] });
    }
  },
}));
