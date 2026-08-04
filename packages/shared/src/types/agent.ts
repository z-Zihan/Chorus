import type { Message, StreamChunk } from "./message";
import type { A2AMode } from "./conversation";

export type AgentStatus = "online" | "offline" | "busy" | "error";
export type AgentType = "openai" | "openclaw" | "dify" | "cli" | "mock" | "custom" | "langchain";

export interface AgentConfig {
  id: string;
  name: string;
  description?: string;
  avatar?: string;
  type: AgentType;
  config: Record<string, unknown>;
}

export type AgentConfigSource = "explicit_config" | "user" | "auto_detected" | "catalog";

export interface PersistedAgentConfig extends AgentConfig {
  source: AgentConfigSource;
  managed: boolean;
  customizedFields: string[];
  catalogEntryId?: string;
  detectionFingerprint?: string;
  disabled: boolean;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  type: AgentType;
  status: AgentStatus;
  model?: string;
  error?: string;
  disabled: boolean;
  catalogEntryId?: string;
  ownerId?: string;
  ownerType?: "local" | "remote" | "system";
  createdAt: number;
  updatedAt: number;
}

export interface A2ABusLike {
  call(
    fromAgentId: string,
    toAgentId: string,
    message: string,
    context: ConversationContext,
  ): AsyncGenerator<StreamChunk>;
}

export interface ConversationContext {
  conversationId: string;
  history: Message[];
  a2aMode?: A2AMode;
  mentionedAgents?: string[];
  availableAgentIds?: string[];
  a2aBus?: A2ABusLike;
  callStack?: string[];
  a2aThreadId?: string;
  a2aCallerName?: string;
  a2aContextSummary?: string;
  parentMessageId?: string;
  difyConversationId?: string;
  signal?: AbortSignal;
}

export interface AgentAdapter {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly avatar?: string;
  readonly config: Record<string, unknown>;
  init(config: Record<string, unknown>): Promise<void>;
  handleMessage(message: string, context: ConversationContext): AsyncGenerator<StreamChunk>;
  handleA2ACall?(
    from: string,
    message: string,
    context: ConversationContext,
  ): AsyncGenerator<StreamChunk>;
  getStatus(): AgentStatus;
  healthCheck?(): Promise<boolean>;
  destroy?(): void;
}
