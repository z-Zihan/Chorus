import type { Agent, AgentConfig, Conversation, Message } from "@agentlink/shared";

const API_BASE = "/api";

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
  sendMessage: (conversationId: string, content: string) =>
    request<Message>(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
};
