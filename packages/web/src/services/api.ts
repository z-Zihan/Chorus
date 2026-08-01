import type { Agent, AgentConfig, CliDetection, Conversation, Message, OnboardingStatus } from "@agentlink/shared";
import { useUIStore } from "@/store/uiStore";
import { getApiBaseUrl } from "./env";
import i18n from "@/i18n";

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

export const api = {
  // Health
  health: () => request<{ ok: boolean }>("/health"),

  // Agents
  getAgents: () => request<Agent[]>("/agents"),
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
    request<void>(`/agents/${id}`, { method: "DELETE" }),

  // Conversations
  getConversations: () => request<Conversation[]>("/conversations"),
  createConversation: (title?: string) =>
    request<Conversation>("/conversations", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  deleteConversation: (id: string) =>
    request<void>(`/conversations/${id}`, { method: "DELETE" }),

  // Messages
  getMessages: (conversationId: string) =>
    request<Message[]>(`/conversations/${conversationId}/messages`),
  sendMessage: (conversationId: string, content: string, signal?: AbortSignal) =>
    request<Message>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
      signal,
    }),

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
