import { create } from "zustand";
import { api, type MessageSearchResult } from "@/services/api";
import { logger } from "@/utils/logger";

export interface SearchFilters {
  agentId?: string;
  startDate?: number;
  endDate?: number;
}

interface SearchState {
  query: string;
  results: MessageSearchResult[];
  isSearching: boolean;
  filters: SearchFilters;
  setQuery: (query: string) => void;
  setFilters: (filters: Partial<SearchFilters>) => void;
  search: (query: string) => Promise<void>;
  clearResults: () => void;
}

let searchRequestId = 0;

export const useSearchStore = create<SearchState>((set, get) => ({
  query: "",
  results: [],
  isSearching: false,
  filters: {},

  setQuery: (query) => set({ query }),
  setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
  search: async (query) => {
    const trimmed = query.trim();
    const requestId = ++searchRequestId;
    set({ query, isSearching: Boolean(trimmed) });
    if (!trimmed) {
      set({ results: [], isSearching: false });
      return;
    }
    try {
      const results = await api.searchMessages(trimmed, get().filters);
      if (requestId === searchRequestId) set({ results, isSearching: false });
    } catch (error) {
      logger.error("Failed to search messages", error);
      if (requestId === searchRequestId) set({ results: [], isSearching: false });
    }
  },
  clearResults: () => {
    searchRequestId += 1;
    set({ query: "", results: [], isSearching: false });
  },
}));
