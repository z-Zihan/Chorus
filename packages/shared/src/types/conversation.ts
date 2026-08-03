export type ConversationType = "dm" | "channel" | "group";

export interface Conversation {
  id: string;
  title: string;
  type: ConversationType;
  agentIds: string[];
  pinned: boolean;
  archived: boolean;
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
