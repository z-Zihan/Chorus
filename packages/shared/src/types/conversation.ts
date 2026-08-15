export type ConversationType = "dm" | "group" | "cross_hub";
export type A2AMode = "mention" | "call" | "off";
export type A2APolicy = "auto" | "confirm" | "deny";

export interface A2ACollaborationSettings {
  /** One round is one automatic Agent-to-Agent handoff. */
  maxRounds: number;
  /** Maximum wall-clock time for one Agent-to-Agent call. */
  callTimeoutMinutes: number;
}

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
