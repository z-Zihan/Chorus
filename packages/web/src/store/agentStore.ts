import { create } from "zustand";
import type { Agent, AgentConfig, AgentStatus } from "@agentlink/shared";
import { api } from "@/services/api";

export type { Agent, AgentStatus } from "@agentlink/shared";

interface AgentState {
  agents: Agent[];
  isLoading: boolean;
  selectedAgentId: string | null;

  fetchAgents: () => Promise<void>;
  updateAgent: (
    agentId: string,
    data: Partial<Pick<AgentConfig, "name" | "description" | "avatar" | "config">>
  ) => Promise<Agent>;
  updateAgentStatus: (agentId: string, status: AgentStatus) => void;
  selectAgent: (agentId: string) => void;
  clearSelectedAgent: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  isLoading: false,
  selectedAgentId: null,

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

  updateAgent: async (agentId, data) => {
    const updatedAgent = await api.updateAgent(agentId, data);
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === agentId ? updatedAgent : agent
      ),
    }));
    return updatedAgent;
  },

  updateAgentStatus: (agentId, status) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId ? { ...a, status } : a
      ),
    })),

  selectAgent: (agentId) => set({ selectedAgentId: agentId }),
  clearSelectedAgent: () => set({ selectedAgentId: null }),
}));
