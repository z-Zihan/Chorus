import { create } from "zustand";

export type ToastType = "error" | "info" | "success";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface UIState {
  toasts: Toast[];
  isOffline: boolean;
  isSidebarOpen: boolean;
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
  setOffline: (isOffline: boolean) => void;
  openSidebar: () => void;
  closeSidebar: () => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  toasts: [],
  isOffline: false,
  isSidebarOpen: false,

  addToast: (message, type = "info") => {
    const id = crypto.randomUUID();
    set((state) => ({
      toasts: [...state.toasts, { id, message, type }],
    }));
    setTimeout(() => get().removeToast(id), 5_000);
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),

  setOffline: (isOffline) => set({ isOffline }),
  openSidebar: () => set({ isSidebarOpen: true }),
  closeSidebar: () => set({ isSidebarOpen: false }),
}));
