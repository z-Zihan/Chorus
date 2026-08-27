import type {
  A2ACollaborationSettings,
  A2AMode,
  Agent,
  AgentConfig,
  AgentMetrics,
  CliDetection,
  Conversation,
  ConversationType,
  CreateConversationInput,
  CredentialStatus,
  HubPeerStatus,
  HubRoom,
  HubStatusResponse,
  Message,
  OnboardingStatus,
  PairingSessionView,
  RoomInvitation,
  LogEntry,
} from "@chorus/shared";
import { useUIStore } from "@/store/uiStore";
import { getApiBaseUrl } from "./env";
import i18n from "@/i18n";
import type { CatalogEntry, InstallationStatus, InstallOptions } from "@/store/catalogStore";
import type { PluginInfo } from "@/store/pluginStore";
import type { CreateScheduledTaskInput, ScheduledTask } from "@/store/schedulerStore";

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

export type ServerLogEntry = LogEntry;

export type { A2AMode, CredentialStatus, HubPeerStatus };
export type PairingSession = PairingSessionView;

// ===== API =====

let lastOfflineToastAt = 0;

// Set by the chat store at module init (registering directly would create an
// api → store → api import cycle).
type ConversationNotFoundHandler = (conversationId: string) => void;
let conversationNotFoundHandler: ConversationNotFoundHandler | null = null;

export function registerConversationNotFoundHandler(handler: ConversationNotFoundHandler): void {
  conversationNotFoundHandler = handler;
}

function reportConversationNotFound(path: string, error: string): void {
  if (error !== "Conversation not found" || !conversationNotFoundHandler) return;
  const match = /\/conversations\/([^/?#]+)/.exec(path);
  const conversationId = match?.[1];
  if (conversationId) conversationNotFoundHandler(decodeURIComponent(conversationId));
}

async function request<T>(path: string, options?: RequestInit, silent = false): Promise<T> {
  let res: Response;
  try {
    const headers = new Headers(options?.headers);
    if (
      options?.body !== undefined &&
      !(options.body instanceof FormData) &&
      !headers.has("Content-Type")
    ) {
      headers.set("Content-Type", "application/json");
    }
    res = await fetch(`${getApiBaseUrl()}${path}`, {
      ...options,
      headers,
    });
    useUIStore.getState().setOffline(false);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    const ui = useUIStore.getState();
    ui.setOffline(true);
    const now = Date.now();
    if (!silent && now - lastOfflineToastAt >= 5_000) {
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
      if (res.status === 404 && parsed.error) reportConversationNotFound(path, parsed.error);
    } catch {
      // Keep the plain-text response as the error message.
    }
    if (!silent) useUIStore.getState().addToast(message, "error");
    throw new Error(message);
  }

  return res.json();
}

async function requestBlob(path: string, silent = false): Promise<Blob> {
  const res = await fetch(`${getApiBaseUrl()}${path}`);
  if (!res.ok) {
    const message = (await res.text()) || i18n.t("errors:requestFailed", { status: res.status });
    if (!silent) useUIStore.getState().addToast(message, "error");
    throw new Error(message);
  }
  return res.blob();
}

export const api = {
  createWebSocketTicket: () =>
    request<{ token: string; id: string; expiresInMs: number }>("/tokens/ticket", {
      method: "POST",
    }),

  // Hub
  getHubStatus: () => request<HubStatusResponse>("/hub/status", undefined, true),

  // Agents
  getAgents: (includeDisabled = false, silent = false) =>
    request<Agent[]>(`/agents${includeDisabled ? "?includeDisabled=true" : ""}`, undefined, silent),
  getAgent: (id: string, silent = false) => request<Agent>(`/agents/${id}`, undefined, silent),
  getAgentMetrics: (id: string) => request<AgentMetrics>(`/agents/${id}/metrics`, undefined, true),
  createAgent: (data: AgentConfig) =>
    request<Agent>("/agents", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateAgent: (
    id: string,
    data: Partial<Pick<AgentConfig, "name" | "description" | "avatar" | "config" | "visibility">>,
  ) =>
    request<Agent>(`/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteAgent: (id: string, silent = false) =>
    request<{ ok: boolean }>(`/agents/${id}`, { method: "DELETE" }, silent),

  setAgentDisabled: (id: string, disabled: boolean, silent = false) =>
    request<Agent>(
      `/agents/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ disabled }),
      },
      silent,
    ),

  getCredentialStatus: (silent = false) =>
    request<CredentialStatus>("/credentials", undefined, silent),
  clearAllCredentials: (silent = false) =>
    request<{ ok: boolean }>("/credentials", { method: "DELETE" }, silent),

  // Catalog
  getCatalog: (silent = false) => request<CatalogEntry[]>("/catalog", undefined, silent),
  installCatalogEntry: (id: string, options: InstallOptions) =>
    request<InstallationStatus>(`/catalog/${id}/install`, {
      method: "POST",
      body: JSON.stringify(options),
    }),
  getInstallation: (id: string) => request<InstallationStatus>(`/installations/${id}`),
  cancelInstallation: (id: string) =>
    request<InstallationStatus>(`/installations/${id}/cancel`, {
      method: "POST",
    }),

  // Scheduled tasks
  getScheduledTasks: (silent = false) =>
    request<ScheduledTask[]>("/scheduler/tasks", undefined, silent),
  createScheduledTask: (data: CreateScheduledTaskInput, silent = false) =>
    request<ScheduledTask>(
      "/scheduler/tasks",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
      silent,
    ),
  deleteScheduledTask: (id: string, silent = false) =>
    request<{ ok: boolean }>(`/scheduler/tasks/${id}`, { method: "DELETE" }, silent),
  setScheduledTaskEnabled: (id: string, enabled: boolean, silent = false) =>
    request<ScheduledTask>(
      `/scheduler/tasks/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      },
      silent,
    ),

  // Plugins
  getPlugins: (silent = false) => request<PluginInfo[]>("/plugins", undefined, silent),

  // A2A mode per conversation
  getA2ACollaborationSettings: (silent = false) =>
    request<A2ACollaborationSettings>("/a2a/settings", undefined, silent),
  setA2ACollaborationSettings: (settings: A2ACollaborationSettings, silent = false) =>
    request<A2ACollaborationSettings>(
      "/a2a/settings",
      { method: "PATCH", body: JSON.stringify(settings) },
      silent,
    ),
  getA2AMode: (conversationId: string, silent = false) =>
    request<{ mode: A2AMode }>(`/conversations/${conversationId}/a2a-mode`, undefined, silent),
  setA2AMode: (conversationId: string, mode: A2AMode, silent = false) =>
    request<{ mode: A2AMode }>(
      `/conversations/${conversationId}/a2a-mode`,
      {
        method: "PATCH",
        body: JSON.stringify({ mode }),
      },
      silent,
    ),

  // Trust management
  getTrustList: (silent = false) =>
    request<
      Array<{
        hubId: string;
        hubFingerprint: string;
        userName?: string;
        trustLevel: string;
        lastSeenAt?: number;
        pairedAt?: number;
      }>
    >("/trust", undefined, silent),
  createPairing: (hubId: string, silent = false) =>
    request<{ pairingPackage: string; session: PairingSession }>(
      "/trust/pair",
      {
        method: "POST",
        body: JSON.stringify({ hubId }),
      },
      silent,
    ),
  acceptPairing: (pairingPackage: string, silent = false) =>
    request<PairingSession>(
      "/trust/pairing-sessions/accept",
      {
        method: "POST",
        body: JSON.stringify({ pairingPackage }),
      },
      silent,
    ),
  getPairingSession: (sessionId: string, silent = false) =>
    request<PairingSession>(`/trust/pairing-sessions/${sessionId}`, undefined, silent),
  approvePairing: (sessionId: string, silent = false) =>
    request<PairingSession>(
      `/trust/pairing-sessions/${sessionId}/approve`,
      { method: "POST" },
      silent,
    ),
  cancelPairing: (sessionId: string, silent = false) =>
    request<PairingSession>(
      `/trust/pairing-sessions/${sessionId}/cancel`,
      { method: "POST" },
      silent,
    ),
  blockHub: (hubId: string, silent = false) =>
    request<{ success: boolean }>(
      `/trust/block`,
      { method: "POST", body: JSON.stringify({ hubId }) },
      silent,
    ),
  removeTrust: (hubId: string, silent = false) =>
    request<{ success: boolean }>(`/trust/${hubId}`, { method: "DELETE" }, silent),

  // Conversations
  getConversations: (archived = false, type?: ConversationType, silent = false) => {
    const params = new URLSearchParams();
    if (archived) params.set("archived", "true");
    if (type) params.set("type", type);
    const query = params.toString();
    return request<Conversation[]>(`/conversations${query ? `?${query}` : ""}`, undefined, silent);
  },
  createConversation: (
    title?: string,
    agentId?: string | string[],
    type: ConversationType = "dm",
    silent = false,
  ) =>
    request<Conversation>(
      "/conversations",
      {
        method: "POST",
        body: JSON.stringify({
          title,
          agentId: typeof agentId === "string" ? agentId : undefined,
          agentIds: Array.isArray(agentId) ? agentId : undefined,
          type,
        } satisfies CreateConversationInput & { agentId?: string }),
      },
      silent,
    ),
  getConversationMembers: (conversationId: string, silent = false) =>
    request<Agent[]>(`/conversations/${conversationId}/members`, undefined, silent),
  addConversationMembers: (conversationId: string, agentIds: string[], silent = false) =>
    request<Conversation>(
      `/conversations/${conversationId}/members`,
      {
        method: "POST",
        body: JSON.stringify({ agentIds }),
      },
      silent,
    ),
  removeConversationMember: (conversationId: string, agentId: string, silent = false) =>
    request<Conversation>(
      `/conversations/${conversationId}/members/${agentId}`,
      { method: "DELETE" },
      silent,
    ),
  deleteConversation: (id: string, silent = false) =>
    request<{ ok: boolean }>(`/conversations/${id}`, { method: "DELETE" }, silent),
  updateConversation: (
    id: string,
    data: Partial<Pick<Conversation, "title" | "pinned" | "archived">>,
    silent = false,
  ) =>
    request<Conversation>(
      `/conversations/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify(data),
      },
      silent,
    ),
  confirmA2A: (threadId: string, approved: boolean, silent = false) =>
    request<{ ok: boolean }>(
      "/a2a/confirm",
      {
        method: "POST",
        body: JSON.stringify({ threadId, approved }),
      },
      silent,
    ),
  exportConversation: (id: string, format: "markdown" | "json") =>
    requestBlob(`/conversations/${encodeURIComponent(id)}/export?format=${format}`, true),

  // Messages
  getMessages: (conversationId: string, silent = false) =>
    request<Message[]>(`/conversations/${conversationId}/messages`, undefined, silent),
  sendMessage: (
    conversationId: string,
    content: string,
    signal?: AbortSignal,
    agentId?: string,
    mentionedAgents?: string[],
  ) =>
    request<Message>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, agentId, mentionedAgents }),
      signal,
    }),
  searchMessages: (query: string, filters: SearchFilters = {}, silent = false) => {
    const params = new URLSearchParams({ q: query });
    if (filters.conversationId) params.set("conversation_id", filters.conversationId);
    if (filters.agentId) params.set("agent_id", filters.agentId);
    if (filters.startDate !== undefined) params.set("start_date", String(filters.startDate));
    if (filters.endDate !== undefined) params.set("end_date", String(filters.endDate));
    if (filters.limit !== undefined) params.set("limit", String(filters.limit));
    return request<MessageSearchResult[]>(
      `/messages/search?${params.toString()}`,
      undefined,
      silent,
    );
  },

  // Diagnostics
  getLogs: (level?: string, limit = 500) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (level && level !== "all") params.set("level", level);
    return request<ServerLogEntry[]>(`/logs?${params.toString()}`);
  },

  // Onboarding
  getOnboardingStatus: () => request<OnboardingStatus>("/onboarding/status", undefined, true),
  rescanOnboarding: () => request<OnboardingStatus>("/onboarding/rescan", { method: "POST" }, true),
  selectOnboardingAgent: (detectionId: string) =>
    request<OnboardingStatus>(
      "/onboarding/select-agent",
      {
        method: "POST",
        body: JSON.stringify({ detectionId }),
      },
      true,
    ),
  completeOnboarding: () => request<OnboardingStatus>("/onboarding/complete", { method: "POST" }),

  // CLI Detections
  getCliDetections: () => request<CliDetection[]>("/cli/detections"),
  adoptDetection: (id: string) => request<Agent>(`/cli/detections/${id}/adopt`, { method: "POST" }),

  // Hub config
  getHubConfig: () =>
    request<{
      displayName: string;
      relayUrl: string;
      p2pEnabled: boolean;
      p2pPort: number;
      hubId: string;
    }>("/hub/config", undefined, true),
  updateHubConfig: (
    config: { displayName?: string; relayUrl?: string; p2pEnabled?: boolean; p2pPort?: number },
    silent = false,
  ) =>
    request<{ displayName: string; relayUrl: string; p2pEnabled: boolean; p2pPort: number }>(
      "/hub/config",
      {
        method: "PATCH",
        body: JSON.stringify(config),
      },
      silent,
    ),
  // Hub rooms
  getHubRooms: () => request<Conversation[]>("/hub/rooms"),
  getHubRoom: (id: string, silent = false) =>
    request<HubRoom>(`/hub/rooms/${encodeURIComponent(id)}`, undefined, silent),
  createHubRoom: (name: string, silent = false) =>
    request<{ roomId: string; name: string }>(
      "/hub/rooms",
      {
        method: "POST",
        body: JSON.stringify({ name }),
      },
      silent,
    ),
  addAgentToRoom: (roomId: string, agentId: string, silent = false) =>
    request<{ ok: boolean; agentId: string }>(
      `/hub/rooms/${encodeURIComponent(roomId)}/agents`,
      {
        method: "POST",
        body: JSON.stringify({ agentId }),
      },
      silent,
    ),
  removeAgentFromRoom: (roomId: string, agentId: string, silent = false) =>
    request<{ ok: boolean }>(
      `/hub/rooms/${encodeURIComponent(roomId)}/agents/${encodeURIComponent(agentId)}`,
      { method: "DELETE" },
      silent,
    ),
  // P2P
  getP2PStatus: () =>
    request<{
      enabled: boolean;
      port: number;
      connected: Array<{
        hubId: string;
        displayName: string;
        latency: number | null;
        status: string;
      }>;
      discovered: Array<{ hubId: string; displayName: string }>;
    }>("/hub/p2p/status"),
  connectP2PDevice: (hubId: string) =>
    request<{ ok: boolean }>("/hub/p2p/connect", {
      method: "POST",
      body: JSON.stringify({ hubId }),
    }),
  dismissP2PDevice: (hubId: string) =>
    request<{ ok: boolean }>("/hub/p2p/dismiss", {
      method: "POST",
      body: JSON.stringify({ hubId }),
    }),

  inviteHubToRoom: (roomId: string, hubId: string, silent = false) =>
    request<{ ok: boolean; invitation: RoomInvitation }>(
      `/hub/rooms/${encodeURIComponent(roomId)}/invite`,
      {
        method: "POST",
        body: JSON.stringify({ hubId }),
      },
      silent,
    ),
  getRoomInvitations: () =>
    request<{ invitations: RoomInvitation[] }>("/hub/room-invitations", undefined, true),
  acceptRoomInvitation: (roomId: string) =>
    request<{ invitation: RoomInvitation; conversation: Conversation }>(
      `/hub/room-invitations/${encodeURIComponent(roomId)}/accept`,
      { method: "POST" },
      true,
    ),
  declineRoomInvitation: (roomId: string) =>
    request<{ invitation: RoomInvitation }>(
      `/hub/room-invitations/${encodeURIComponent(roomId)}/decline`,
      { method: "POST" },
      true,
    ),
};
