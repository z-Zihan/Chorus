export type MessageStatus =
  | "sending"
  | "thinking"
  | "streaming"
  | "done"
  | "partial"
  | "error";

export type StreamChunkType =
  | "text"
  | "thinking"
  | "tool_call"
  | "a2a_response"
  | "file"
  | "task"
  | "task_step"
  | "pipeline"
  | "done"
  | "error";

export interface StreamChunk {
  type: StreamChunkType;
  content: string;
  metadata?: Record<string, unknown>;
  threadId?: string;
  sourceAgentId?: string;
}

export interface MessageMetadata {
  model?: string;
  tokensUsed?: number;
  durationMs?: number;
  chunks?: StreamChunk[];
  [key: string]: unknown;
}

export interface Message {
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
  status: MessageStatus;
  metadata?: MessageMetadata;
}
