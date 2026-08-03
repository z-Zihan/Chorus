import { create } from "zustand";
import { api } from "@/services/api";
import { logger } from "@/utils/logger";

export interface ScheduledTask {
  id: string;
  agentId: string;
  conversationId: string | null;
  cronExpression: string;
  prompt: string;
  enabled: boolean;
  createdAt: number;
}

export interface CreateScheduledTaskInput {
  agentId: string;
  cronExpression: string;
  prompt: string;
  conversationId?: string;
}

interface SchedulerState {
  tasks: ScheduledTask[];
  isLoading: boolean;
  fetchTasks: () => Promise<void>;
  createTask: (data: CreateScheduledTaskInput) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  toggleTask: (id: string, enabled: boolean) => Promise<void>;
}

export const useSchedulerStore = create<SchedulerState>((set) => ({
  tasks: [],
  isLoading: false,

  fetchTasks: async () => {
    set({ isLoading: true });
    try {
      const tasks = await api.getScheduledTasks();
      set({ tasks, isLoading: false });
    } catch (e) {
      logger.error("Failed to fetch scheduled tasks", e);
      set({ isLoading: false });
    }
  },

  createTask: async (data) => {
    try {
      const task = await api.createScheduledTask(data);
      set((state) => ({ tasks: [...state.tasks, task] }));
    } catch (e) {
      logger.error("Failed to create scheduled task", e);
    }
  },

  deleteTask: async (id) => {
    try {
      await api.deleteScheduledTask(id);
      set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }));
    } catch (e) {
      logger.error("Failed to delete scheduled task", e);
    }
  },

  toggleTask: async (id, enabled) => {
    try {
      const updated = await api.setScheduledTaskEnabled(id, enabled);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
      }));
    } catch (e) {
      logger.error("Failed to toggle scheduled task", e);
    }
  },
}));
