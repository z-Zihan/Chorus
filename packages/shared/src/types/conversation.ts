export type ConversationType = "dm" | "channel" | "group";

export interface Conversation {
  id: string;
  title: string;
  type: ConversationType;
  agentIds: string[];
  lastMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateConversationInput {
  title?: string;
  type?: ConversationType;
  agentId?: string;
}
