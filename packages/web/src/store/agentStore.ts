import { create } from "zustand";
import type { Agent, AgentConfig, AgentStatus, AgentStatusSnapshot } from "@agentlink/shared";
import { api } from "@/services/api";
import { track } from "@/utils/analytics";
import { logger } from "@/utils/logger";

export type { Agent, AgentStatus } from "@agentlink/shared";

interface AgentState {
  agents: Agent[];
  isLoading: boolean;
  selectedAgentId: string | null;
  conversationAgentFilter: string | null;
  statusByAgentId: Record<string, Pick<AgentStatusSnapshot, "status" | "error">>;

  fetchAgents: () => Promise<void>;
  updateAgent: (
    agentId: string,
    data: Partial<Pick<AgentConfig, "name" | "description" | "avatar" | "config">>
  ) => Promise<Agent>;
  updateAgentStatus: (agentId: string, status: AgentStatus, error?: string) => void;
  updateAgentStatuses: (statuses: AgentStatusSnapshot[]) => void;
  setAgentDisabled: (agentId: string, disabled: boolean) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  selectAgent: (agentId: string) => void;
  clearSelectedAgent: () => void;
  filterByAgent: (agentId: string | null) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  isLoading: false,
  selectedAgentId: null,
  conversationAgentFilter: null,
  statusByAgentId: {},

  fetchAgents: async () => {
    set({ isLoading: true });
    try {
      const data = await api.getAgents();
      set((state) => ({
        agents: data.map((agent) => ({
          ...agent,
          ...state.statusByAgentId[agent.id],
        })),
        isLoading: false,
      }));
    } catch (e) {
      logger.error("Failed to fetch agents", e);
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

  updateAgentStatus: (agentId, status, error) =>
    set((state) => ({
      agents: state.agents.map((a) => {
        if (a.id !== agentId) return a;
        if (a.status !== status) track("agent_status_change", { agentId, status });
        return { ...a, status, error };
      }),
      statusByAgentId: { ...state.statusByAgentId, [agentId]: { status, error } },
    })),

  updateAgentStatuses: (statuses) =>
    set((state) => {
      const statusByAgentId = { ...state.statusByAgentId };
      for (const { agentId, status, error } of statuses) {
        statusByAgentId[agentId] = { status, error };
      }
      return {
        statusByAgentId,
        agents: state.agents.map((agent) => {
          const next = statusByAgentId[agent.id];
          return next ? { ...agent, ...next } : agent;
        }),
      };
    }),

  setAgentDisabled: async (agentId, disabled) => {
    await api.setAgentDisabled(agentId, disabled);
    const agents = await api.getAgents();
    set({ agents });
  },

  deleteAgent: async (agentId) => {
    await api.deleteAgent(agentId);
    set((state) => ({
      agents: state.agents.filter((agent) => agent.id !== agentId),
      selectedAgentId: state.selectedAgentId === agentId ? null : state.selectedAgentId,
      conversationAgentFilter: state.conversationAgentFilter === agentId
        ? null
        : state.conversationAgentFilter,
    }));
  },

  selectAgent: (agentId) => set({ selectedAgentId: agentId }),
  clearSelectedAgent: () => set({ selectedAgentId: null }),
  filterByAgent: (agentId) => set({ conversationAgentFilter: agentId }),
}));
