export type ConversationType = "dm" | "group" | "cross_hub";
export type A2AMode = "mention" | "call" | "off";
export type A2APolicy = "auto" | "confirm" | "deny";

export interface Conversation {
  id: string;
  title: string;
  type: ConversationType;
  a2aMode: A2AMode;
  a2aPolicy?: A2APolicy;
  agentIds: string[];
  pinned: boolean;
  archived: boolean;
  relayRoomId?: string;
  metadata?: {
    relayRoomId?: string;
    [key: string]: unknown;
  };
  lastMessage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateConversationInput {
  title?: string;
  type?: ConversationType;
  agentIds?: string[];
}
