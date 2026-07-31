import { create } from "zustand";
import { api } from "@/services/api";

export type AgentStatus = "online" | "offline" | "busy" | "error";

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  avatar: string | null;
  type: string;
  status: AgentStatus;
  config?: {
    model?: string;
    systemPrompt?: string;
    [key: string]: unknown;
  };
  createdAt: number;
  updatedAt: number;
}

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
