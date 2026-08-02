import type { AgentStatus } from "./agent";
import type { Message, StreamChunk } from "./message";

export interface AgentStatusSnapshot {
  agentId: string;
  status: AgentStatus;
  error?: string;
}

export type ClientEvent =
  | { type: "message"; conversationId: string; content: string; agentId?: string; mentionedAgents?: string[] }
  | { type: "typing"; conversationId: string; isTyping: boolean }
  | { type: "subscribe"; conversationId: string; lastEventId?: string }
  | { type: "cancel"; messageId: string }
  | { type: "ping" };

export type ServerEvent =
  | { type: "message"; eventId: string; message: Message }
  | { type: "stream"; eventId: string; messageId: string; chunk: StreamChunk }
  | { type: "a2a_call"; eventId: string; from: string; to: string; message: string; threadId: string }
  | { type: "a2a_confirmation_required"; eventId: string; threadId: string; from: string; to: string; message: string; expiresAt: number }
  | { type: "a2a_response"; eventId: string; threadId: string; chunk: StreamChunk }
  | { type: "tool_call_start"; eventId: string; threadId: string; conversationId?: string; parentMessageId?: string; from: string; to: string; message: string }
  | { type: "tool_call_result"; eventId: string; threadId: string; result: string }
  | { type: "tool_call_error"; eventId: string; threadId: string; error: string }
  | { type: "agent_status"; eventId: string; agentId: string; status: AgentStatus; error?: string }
  | { type: "agent_status_batch"; eventId: string; statuses: AgentStatusSnapshot[] }
  | { type: "typing"; eventId: string; agentId: string; conversationId: string; isTyping: boolean }
  | { type: "error"; eventId: string; message: string }
  | { type: "pong"; eventId: string };
