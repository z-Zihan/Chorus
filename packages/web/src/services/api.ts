import type { Agent, AgentConfig, CliDetection, Conversation, CreateConversationInput, Message, OnboardingStatus } from "@agentlink/shared";
import { useUIStore } from "@/store/uiStore";
import { getApiBaseUrl } from "./env";
import i18n from "@/i18n";
import type {
  CatalogEntry,
  InstallationStatus,
  InstallOptions,
} from "@/store/catalogStore";

export interface SearchFilters {
  conversationId?: string;
  agentId?: string;
  startDate?: number;
  endDate?: number;
  limit?: number;
}

export interface MessageSearchResult {
  message: Message;
  conversation: Conversation;
  before: Message | null;
  after: Message | null;
}

export interface ServerLogEntry {
  timestamp: number;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: unknown;
  source: "backend";
}

// ===== API =====

let lastOfflineToastAt = 0;

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    useUIStore.getState().setOffline(false);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    const ui = useUIStore.getState();
    ui.setOffline(true);
    const now = Date.now();
    if (now - lastOfflineToastAt >= 5_000) {
      lastOfflineToastAt = now;
      ui.addToast(i18n.t("errors:offlineToast"), "error");
    }
    throw error;
  }

  if (!res.ok) {
    const body = await res.text();
    let message = body || i18n.t("errors:requestFailed", { status: res.status });
    try {
      const parsed = JSON.parse(body) as { error?: string; message?: string };
      message = parsed.error ?? parsed.message ?? message;
    } catch {
      // Keep the plain-text response as the error message.
    }
    useUIStore.getState().addToast(message, "error");
    throw new Error(message);
  }

  return res.json();
}

async function requestBlob(path: string): Promise<Blob> {
  const res = await fetch(`${getApiBaseUrl()}${path}`);
  if (!res.ok) {
    const message = await res.text() || i18n.t("errors:requestFailed", { status: res.status });
    useUIStore.getState().addToast(message, "error");
    throw new Error(message);
  }
  return res.blob();
}

export const api = {
  // Health
  health: () => request<{ ok: boolean }>("/health"),

  // Agents
  getAgents: (includeDisabled = false) =>
    request<Agent[]>(`/agents${includeDisabled ? "?includeDisabled=true" : ""}`),
  getAgent: (id: string) => request<Agent>(`/agents/${id}`),
  createAgent: (data: AgentConfig) =>
    request<Agent>("/agents", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateAgent: (id: string, data: Partial<Pick<AgentConfig, "name" | "description" | "avatar" | "config">>) =>
    request<Agent>(`/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteAgent: (id: string) =>
    request<{ ok: boolean }>(`/agents/${id}`, { method: "DELETE" }),

  setAgentDisabled: (id: string, disabled: boolean) =>
    request<Agent>(`/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ disabled }),
    }),

  // Catalog
  getCatalog: () => request<CatalogEntry[]>("/catalog"),
  getCatalogEntry: (id: string) => request<CatalogEntry>(`/catalog/${id}`),
  installCatalogEntry: (id: string, options: InstallOptions) =>
    request<InstallationStatus>(`/catalog/${id}/install`, {
      method: "POST",
      body: JSON.stringify(options),
    }),
  getInstallation: (id: string) =>
    request<InstallationStatus>(`/installations/${id}`),
  cancelInstallation: (id: string) =>
    request<InstallationStatus>(`/installations/${id}/cancel`, {
      method: "POST",
    }),

  // Conversations
  getConversations: (archived = false) =>
    request<Conversation[]>(`/conversations${archived ? "?archived=true" : ""}`),
  createConversation: (title?: string, agentIds?: string[]) =>
    request<Conversation>("/conversations", {
      method: "POST",
      body: JSON.stringify({ title, agentIds } satisfies CreateConversationInput),
    }),
  addAgentToConversation: (conversationId: string, agentId: string) =>
    request<Conversation>(`/conversations/${conversationId}/agents/${agentId}`, { method: "POST" }),
  removeAgentFromConversation: (conversationId: string, agentId: string) =>
    request<Conversation>(`/conversations/${conversationId}/agents/${agentId}`, { method: "DELETE" }),
  deleteConversation: (id: string) =>
    request<{ ok: boolean }>(`/conversations/${id}`, { method: "DELETE" }),
  updateConversation: (
    id: string,
    data: Partial<Pick<Conversation, "title" | "pinned" | "archived">>,
  ) => request<Conversation>(`/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  }),
  deleteConversations: (ids: string[]) =>
    request<{ count: number }>("/conversations/batch", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    }),
  exportConversation: (id: string, format: "markdown" | "json") =>
    requestBlob(`/conversations/${encodeURIComponent(id)}/export?format=${format}`),

  // Messages
  getMessages: (conversationId: string) =>
    request<Message[]>(`/conversations/${conversationId}/messages`),
  sendMessage: (conversationId: string, content: string, signal?: AbortSignal, agentId?: string) =>
    request<Message>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, agentId }),
      signal,
    }),
  searchMessages: (query: string, filters: SearchFilters = {}) => {
    const params = new URLSearchParams({ q: query });
    if (filters.conversationId) params.set("conversation_id", filters.conversationId);
    if (filters.agentId) params.set("agent_id", filters.agentId);
    if (filters.startDate !== undefined) params.set("start_date", String(filters.startDate));
    if (filters.endDate !== undefined) params.set("end_date", String(filters.endDate));
    if (filters.limit !== undefined) params.set("limit", String(filters.limit));
    return request<MessageSearchResult[]>(`/messages/search?${params.toString()}`);
  },

  // Diagnostics
  getLogs: (level?: string, limit = 500) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (level && level !== "all") params.set("level", level);
    return request<ServerLogEntry[]>(`/logs?${params.toString()}`);
  },

  // Onboarding
  getOnboardingStatus: () => request<OnboardingStatus>("/onboarding/status"),
  rescanOnboarding: () => request<OnboardingStatus>("/onboarding/rescan", { method: "POST" }),
  selectOnboardingAgent: (detectionId: string) =>
    request<OnboardingStatus>("/onboarding/select-agent", {
      method: "POST",
      body: JSON.stringify({ detectionId }),
    }),
  completeOnboarding: () =>
    request<OnboardingStatus>("/onboarding/complete", { method: "POST" }),

  // CLI Detections
  getCliDetections: () => request<CliDetection[]>("/cli/detections"),
  scanCliDetections: () => request<CliDetection[]>("/cli/detections/scan", { method: "POST" }),
  adoptDetection: (id: string) =>
    request<Agent>(`/cli/detections/${id}/adopt`, { method: "POST" }),
};
