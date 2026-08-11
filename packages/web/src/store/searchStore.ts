import { create } from "zustand";
import { api, type MessageSearchResult } from "@/services/api";
import { logger } from "@/utils/logger";
import i18n from "@/i18n";

export interface SearchFilters {
  agentId?: string;
  startDate?: number;
  endDate?: number;
}

interface SearchState {
  query: string;
  results: MessageSearchResult[];
  isSearching: boolean;
  error: string | null;
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
  error: null,
  filters: {},

  setQuery: (query) => set({ query }),
  setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
  search: async (query) => {
    const trimmed = query.trim();
    const requestId = ++searchRequestId;
    set({ query, isSearching: Boolean(trimmed), error: null });
    if (!trimmed) {
      set({ results: [], isSearching: false, error: null });
      return;
    }
    try {
      const results = await api.searchMessages(trimmed, get().filters, true);
      if (requestId === searchRequestId) set({ results, isSearching: false, error: null });
    } catch (error) {
      logger.error("Failed to search messages", error);
      if (requestId === searchRequestId) {
        set({
          results: [],
          isSearching: false,
          error: i18n.t("common:search.loadFailed"),
        });
      }
    }
  },
  clearResults: () => {
    searchRequestId += 1;
    set({ query: "", results: [], isSearching: false, error: null });
  },
}));
