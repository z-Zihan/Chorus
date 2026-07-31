import { create } from "zustand";
import type { Agent, AgentStatus } from "@agentlink/shared";
import { api } from "@/services/api";

export type { Agent, AgentStatus } from "@agentlink/shared";

interface AgentState {
  agents: Agent[];
  isLoading: boolean;

  fetchAgents: () => Promise<void>;
  updateAgentStatus: (agentId: string, status: AgentStatus) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  isLoading: false,

  fetchAgents: async () => {
    set({ isLoading: true });
    try {
      const data = await api.getAgents();
      set({ agents: data, isLoading: false });
    } catch (e) {
      console.error("Failed to fetch agents:", e);
      set({ isLoading: false });
    }
  },

  updateAgentStatus: (agentId, status) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId ? { ...a, status } : a
      ),
    })),
}));
