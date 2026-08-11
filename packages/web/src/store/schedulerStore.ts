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
  loadError: boolean;
  fetchTasks: () => Promise<void>;
  createTask: (data: CreateScheduledTaskInput) => Promise<ScheduledTask>;
  deleteTask: (id: string) => Promise<void>;
  toggleTask: (id: string, enabled: boolean) => Promise<ScheduledTask>;
}

export const useSchedulerStore = create<SchedulerState>((set, get) => ({
  tasks: [],
  isLoading: false,
  loadError: false,

  fetchTasks: async () => {
    set({ isLoading: true, loadError: false });
    try {
      const tasks = await api.getScheduledTasks(true);
      set({ tasks, isLoading: false, loadError: false });
    } catch (e) {
      logger.error("Failed to fetch scheduled tasks", e);
      set({ isLoading: false, loadError: true });
    }
  },

  createTask: async (data) => {
    try {
      const task = await api.createScheduledTask(data, true);
      set((state) => ({ tasks: [...state.tasks, task] }));
      return task;
    } catch (e) {
      logger.error("Failed to create scheduled task", e);
      throw e;
    }
  },

  deleteTask: async (id) => {
    try {
      await api.deleteScheduledTask(id, true);
      set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }));
    } catch (e) {
      logger.error("Failed to delete scheduled task", e);
      throw e;
    }
  },

  toggleTask: async (id, enabled) => {
    const previous = get().tasks.find((task) => task.id === id);
    set((state) => ({
      tasks: state.tasks.map((task) => (task.id === id ? { ...task, enabled } : task)),
    }));
    try {
      const updated = await api.setScheduledTaskEnabled(id, enabled, true);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
      }));
      return updated;
    } catch (e) {
      logger.error("Failed to toggle scheduled task", e);
      if (previous) {
        set((state) => ({
          tasks: state.tasks.map((task) => (task.id === id ? previous : task)),
        }));
      }
      throw e;
    }
  },
}));
