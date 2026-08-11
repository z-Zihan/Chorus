import { create } from "zustand";
import type { Agent, AgentConfig, AgentStatus, AgentStatusSnapshot } from "@chorus/shared";
import { api } from "@/services/api";
import { track } from "@/utils/analytics";
import { logger } from "@/utils/logger";

export type { Agent, AgentStatus } from "@chorus/shared";

export type AgentHealthState = "healthy" | "checking" | "unhealthy";

export interface AgentGroup {
  user: { id: string; name: string; kind: "local" | "remote" };
  agents: Agent[];
}

export interface AgentHealthStatus {
  status: AgentHealthState;
  lastCheck: number | null;
  reason?: string;
}

interface AgentState {
  agents: Agent[];
  isLoading: boolean;
  selectedAgentId: string | null;
  conversationAgentFilter: string | null;
  statusByAgentId: Record<string, Pick<AgentStatusSnapshot, "status" | "error">>;
  healthStatus: Record<string, AgentHealthStatus>;

  fetchAgents: () => Promise<void>;
  fetchHealthStatus: () => Promise<void>;
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
  fetchGroupedAgents: () => Promise<AgentGroup[]>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  isLoading: false,
  selectedAgentId: null,
  conversationAgentFilter: null,
  statusByAgentId: {},
  healthStatus: {},

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

  fetchHealthStatus: async () => {
    const agents = get().agents;
    if (agents.length === 0) return;
    set((state) => ({
      healthStatus: {
        ...state.healthStatus,
        ...Object.fromEntries(agents.map((agent) => [agent.id, {
          status: "checking" as const,
          lastCheck: state.healthStatus[agent.id]?.lastCheck ?? null,
        }])),
      },
    }));

    await Promise.all(agents.map(async (agent) => {
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
    }));
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
    set((state) => {
      const healthStatus = { ...state.healthStatus };
      delete healthStatus[agentId];
      return {
        agents: state.agents.filter((agent) => agent.id !== agentId),
        healthStatus,
        selectedAgentId: state.selectedAgentId === agentId ? null : state.selectedAgentId,
        conversationAgentFilter: state.conversationAgentFilter === agentId
          ? null
          : state.conversationAgentFilter,
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

  fetchGroupedAgents: async () => {
    const users = await api.getUsersWithAgents();
    const groups: AgentGroup[] = users
      .map((user) => ({
        user: { id: user.id, name: user.name, kind: user.kind },
        agents: user.agents ?? [],
      }))
      .sort((a, b) => {
        if (a.user.kind === "local" && b.user.kind !== "local") return -1;
        if (a.user.kind !== "local" && b.user.kind === "local") return 1;
        return a.user.name.localeCompare(b.user.name);
      });
    return groups;
  },
}));
