import type { Conversation, Message, MessageStatus } from "@agentlink/shared";
import type { DatabaseContext } from "./index.js";
import type { Repository } from "./repository.js";

export interface MessageSearchFilters {
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

interface MessageRow {
  rowid: number;
  id: string;
  conversation_id: string;
  from_type: string;
  from_id: string;
  to_type: string | null;
  to_id: string | null;
  content: string;
  thread_id: string | null;
  parent_id: string | null;
  status: string;
  metadata: string | null;
  created_at: number;
}

export function searchMessages(
  context: DatabaseContext,
  repository: Repository,
  query: string,
  filters: MessageSearchFilters = {},
): MessageSearchResult[] {
  const clauses = ["messages_fts MATCH @query"];
  const parameters: Record<string, string | number> = { query: toFtsQuery(query) };

  if (filters.conversationId) {
    clauses.push("m.conversation_id = @conversationId");
    parameters.conversationId = filters.conversationId;
  }
  if (filters.agentId) {
    clauses.push("m.from_type = 'agent' AND m.from_id = @agentId");
    parameters.agentId = filters.agentId;
  }
  if (filters.startDate !== undefined) {
    clauses.push("m.created_at >= @startDate");
    parameters.startDate = filters.startDate;
  }
  if (filters.endDate !== undefined) {
    clauses.push("m.created_at <= @endDate");
    parameters.endDate = filters.endDate;
  }
  parameters.limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);

  const rows = context.sqlite.prepare(`
    SELECT m.rowid, m.*
    FROM messages_fts
    JOIN messages m ON m.rowid = messages_fts.rowid
    WHERE ${clauses.join(" AND ")}
    ORDER BY bm25(messages_fts), m.created_at DESC
    LIMIT @limit
  `).all(parameters) as MessageRow[];

  const contextStatement = (direction: "before" | "after") => context.sqlite.prepare(`
    SELECT rowid, * FROM messages
    WHERE conversation_id = @conversationId
      AND (created_at ${direction === "before" ? "<" : ">"} @createdAt
        OR (created_at = @createdAt AND rowid ${direction === "before" ? "<" : ">"} @rowid))
    ORDER BY created_at ${direction === "before" ? "DESC" : "ASC"},
      rowid ${direction === "before" ? "DESC" : "ASC"}
    LIMIT 1
  `);
  const beforeStatement = contextStatement("before");
  const afterStatement = contextStatement("after");

  return rows.flatMap((row) => {
    const conversation = repository.getConversation(row.conversation_id);
    if (!conversation) return [];
    const contextParameters = {
      conversationId: row.conversation_id,
      createdAt: row.created_at,
      rowid: row.rowid,
    };
    const before = beforeStatement.get(contextParameters) as MessageRow | undefined;
    const after = afterStatement.get(contextParameters) as MessageRow | undefined;
    return [{
      message: toMessage(row),
      conversation,
      before: before ? toMessage(before) : null,
      after: after ? toMessage(after) : null,
    }];
  });
}

function toFtsQuery(query: string): string {
  return query.trim().split(/\s+/u).filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"*`)
    .join(" AND ");
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    fromType: row.from_type as Message["fromType"],
    fromId: row.from_id,
    toType: row.to_type as Message["toType"],
    toId: row.to_id ?? undefined,
    content: row.content,
    threadId: row.thread_id ?? undefined,
    parentId: row.parent_id ?? undefined,
    status: row.status as MessageStatus,
    metadata: parseMetadata(row.metadata),
    timestamp: row.created_at,
  };
}

function parseMetadata(value: string | null): Message["metadata"] {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as Message["metadata"];
  } catch {
    return undefined;
  }
}
