import { create } from "zustand";
import type { Agent, AgentConfig, AgentStatus, AgentStatusSnapshot } from "@chorus/shared";
import { api } from "@/services/api";
import { logger } from "@/utils/logger";
import i18n from "@/i18n";

export type { Agent, AgentStatus } from "@chorus/shared";

export type AgentHealthState = "healthy" | "checking" | "unhealthy";

export interface AgentHealthStatus {
  status: AgentHealthState;
  lastCheck: number | null;
  reason?: string;
}

interface AgentState {
  agents: Agent[];
  isLoading: boolean;
  loadError: string | null;
  selectedAgentId: string | null;
  conversationAgentFilter: string | null;
  statusByAgentId: Record<string, Pick<AgentStatusSnapshot, "status" | "error">>;
  healthStatus: Record<string, AgentHealthStatus>;

  fetchAgents: () => Promise<void>;
  fetchHealthStatus: () => Promise<void>;
  updateAgent: (
    agentId: string,
    data: Partial<Pick<AgentConfig, "name" | "description" | "avatar" | "config" | "visibility">>,
  ) => Promise<Agent>;
  updateAgentStatus: (agentId: string, status: AgentStatus, error?: string) => void;
  updateAgentStatuses: (statuses: AgentStatusSnapshot[]) => void;
  setAgentDisabled: (agentId: string, disabled: boolean) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  selectAgent: (agentId: string) => void;
  clearSelectedAgent: () => void;
  filterByAgent: (agentId: string | null) => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  isLoading: false,
  loadError: null,
  selectedAgentId: null,
  conversationAgentFilter: null,
  statusByAgentId: {},
  healthStatus: {},

  fetchAgents: async () => {
    set({ isLoading: true, loadError: null });
    try {
      const data = await api.getAgents(false, true);
      set((state) => ({
        agents: data.map((agent) => ({
          ...agent,
          ...state.statusByAgentId[agent.id],
        })),
        isLoading: false,
        loadError: null,
      }));
    } catch (e) {
      logger.error("Failed to fetch agents", e);
      set({ isLoading: false, loadError: i18n.t("sidebar:agentLoadFailed") });
    }
  },

  fetchHealthStatus: async () => {
    const agents = get().agents;
    if (agents.length === 0) return;
    set((state) => ({
      healthStatus: {
        ...state.healthStatus,
        ...Object.fromEntries(
          agents.map((agent) => [
            agent.id,
            {
              status: "checking" as const,
              lastCheck: state.healthStatus[agent.id]?.lastCheck ?? null,
            },
          ]),
        ),
      },
    }));

    await Promise.all(
      agents.map(async (agent) => {
        try {
          await api.getAgentMetrics(agent.id);
          const currentAgent = get().agents.find((item) => item.id === agent.id) ?? agent;
          const unhealthy = currentAgent.status === "error" || currentAgent.status === "offline";
          set((state) => ({
            healthStatus: {
              ...state.healthStatus,
              [agent.id]: {
                status: unhealthy ? "unhealthy" : "healthy",
                lastCheck: Date.now(),
                reason: unhealthy ? currentAgent.error : undefined,
              },
            },
          }));
        } catch (error) {
          set((state) => ({
            healthStatus: {
              ...state.healthStatus,
              [agent.id]: {
                status: "unhealthy",
                lastCheck: Date.now(),
                reason: error instanceof Error ? error.message : undefined,
              },
            },
          }));
        }
      }),
    );
  },

  updateAgent: async (agentId, data) => {
    const updatedAgent = await api.updateAgent(agentId, data);
    set((state) => ({
      agents: state.agents.map((agent) => (agent.id === agentId ? updatedAgent : agent)),
    }));
    return updatedAgent;
  },

  updateAgentStatus: (agentId, status, error) =>
    set((state) => {
      // Keep the previous references when nothing changed: agent_status events
      // fire per stream chunk, and fresh array/object references retrigger every
      // effect/selector subscribed to `agents` (request storms, form resets).
      const current = state.agents.find((agent) => agent.id === agentId);
      if (!current || (current.status === status && current.error === error)) return state;
      return {
        agents: state.agents.map((agent) =>
          agent.id === agentId ? { ...agent, status, error } : agent,
        ),
        statusByAgentId: { ...state.statusByAgentId, [agentId]: { status, error } },
      };
    }),

  updateAgentStatuses: (statuses) =>
    set((state) => {
      let changed = false;
      const statusByAgentId = { ...state.statusByAgentId };
      for (const { agentId, status, error } of statuses) {
        const existing = statusByAgentId[agentId];
        if (existing && existing.status === status && existing.error === error) continue;
        statusByAgentId[agentId] = { status, error };
        changed = true;
      }
      if (!changed) return state;
      return {
        statusByAgentId,
        agents: state.agents.map((agent) => {
          const next = statusByAgentId[agent.id];
          if (!next || (agent.status === next.status && agent.error === next.error)) return agent;
          return { ...agent, ...next };
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
    set((state) => {
      const healthStatus = Object.fromEntries(
        Object.entries(state.healthStatus).filter(([id]) => id !== agentId),
      );
      return {
        agents: state.agents.filter((agent) => agent.id !== agentId),
        healthStatus,
        selectedAgentId: state.selectedAgentId === agentId ? null : state.selectedAgentId,
        conversationAgentFilter:
          state.conversationAgentFilter === agentId ? null : state.conversationAgentFilter,
      };
    });
  },

  selectAgent: (agentId) => set({ selectedAgentId: agentId }),
  clearSelectedAgent: () => set({ selectedAgentId: null }),
  filterByAgent: (agentId) =>
    set((state) => ({
      conversationAgentFilter: agentId,
      selectedAgentId: agentId ?? state.selectedAgentId,
    })),
}));
