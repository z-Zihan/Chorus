const API_BASE = "/api";

// ===== Types =====

export interface StreamChunk {
  type: "text" | "thinking" | "tool_call" | "file" | "done" | "error";
  content: string;
  metadata?: Record<string, unknown>;
  threadId?: string;
  sourceAgentId?: string;
}

export interface ServerEvent {
  type:
    | "message"
    | "stream"
    | "a2a_call"
    | "a2a_response"
    | "agent_status"
    | "typing"
    | "error"
    | "pong";
  eventId?: string;
  message?: import("@/store/chatStore").Message;
  messageId?: string;
  chunk?: StreamChunk;
  from?: string;
  to?: string;
  threadId?: string;
  agentId?: string;
  status?: import("@/store/agentStore").AgentStatus;
  conversationId?: string;
  isTyping?: boolean;
}

interface Conversation {
  id: string;
  title: string | null;
  type: "dm" | "channel" | "group";
  createdAt: number;
  updatedAt: number;
}

interface Message {
  id: string;
  conversationId: string;
  fromType: "user" | "agent";
  fromId: string;
  toType?: "user" | "agent";
  toId?: string;
  content: string;
  timestamp: number;
  threadId?: string;
  parentId?: string;
  status: "sending" | "thinking" | "streaming" | "done" | "partial" | "error";
  metadata?: Record<string, unknown>;
}

interface Agent {
  id: string;
  name: string;
  description: string | null;
  avatar: string | null;
  type: string;
  config?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

// ===== API =====

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }

  return res.json();
}

export const api = {
  // Health
  health: () => request<{ ok: boolean }>("/health"),

  // Agents
  getAgents: () => request<Agent[]>("/agents"),
  getAgent: (id: string) => request<Agent>(`/agents/${id}`),
  createAgent: (data: Partial<Agent>) =>
    request<Agent>("/agents", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateAgent: (id: string, data: Partial<Agent>) =>
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
  sendMessage: (conversationId: string, content: string) =>
    request<Message>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
};
