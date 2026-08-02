import { randomUUID } from "node:crypto";
import type {
  AgentConfig,
  Conversation,
  Message,
  MessageStatus,
  PersistedAgentConfig,
} from "@agentlink/shared";
import { and, asc, desc, eq, lt } from "drizzle-orm";
import type { DatabaseContext } from "./index";
import { agents, appSettings, conversationAgents, conversations, messages } from "./schema";

export class Repository {
  constructor(readonly context: DatabaseContext) {}

  upsertAgent(agent: AgentConfig | PersistedAgentConfig): void {
    const now = Date.now();
    const persisted = toPersistedAgent(agent);
    this.context.db.insert(agents).values({
      id: persisted.id,
      name: persisted.name,
      description: persisted.description ?? "",
      avatar: persisted.avatar,
      type: persisted.type,
      config: JSON.stringify(persisted.config),
      source: persisted.source,
      managed: persisted.managed,
      customizedFields: JSON.stringify(persisted.customizedFields),
      catalogEntryId: persisted.catalogEntryId,
      detectionFingerprint: persisted.detectionFingerprint,
      disabled: persisted.disabled,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: agents.id,
      set: {
        name: persisted.name,
        description: persisted.description ?? "",
        avatar: persisted.avatar,
        type: persisted.type,
        config: JSON.stringify(persisted.config),
        source: persisted.source,
        managed: persisted.managed,
        customizedFields: JSON.stringify(persisted.customizedFields),
        catalogEntryId: persisted.catalogEntryId,
        detectionFingerprint: persisted.detectionFingerprint,
        disabled: persisted.disabled,
        updatedAt: now,
      },
    }).run();
  }

  getAgentRow(id: string) {
    return this.context.db.select().from(agents).where(eq(agents.id, id)).get();
  }

  listAgentRows() {
    return this.context.db.select().from(agents).orderBy(asc(agents.createdAt)).all();
  }

  deleteAgent(id: string): boolean {
    const agent = this.getAgentRow(id);
    if (!agent) return false;
    const transaction = this.context.sqlite.transaction(() => {
      const authoredMessages = this.context.db.select().from(messages)
        .where(eq(messages.fromId, id)).all();
      for (const message of authoredMessages) {
        const metadata = safeJson<Record<string, unknown>>(message.metadata, {});
        this.context.db.update(messages).set({
          metadata: JSON.stringify({
            ...metadata,
            agentSnapshot: {
              id: agent.id,
              name: agent.name,
              description: agent.description ?? "",
              avatar: agent.avatar ?? undefined,
              type: agent.type,
            },
          }),
        }).where(eq(messages.id, message.id)).run();
      }
      this.context.db.delete(conversationAgents).where(eq(conversationAgents.agentId, id)).run();
      return this.context.db.delete(agents).where(eq(agents.id, id)).run().changes > 0;
    });
    return transaction();
  }

  updateAgent(id: string, input: Partial<Pick<AgentConfig, "name" | "description" | "avatar" | "config">>): boolean {
    const current = this.getAgentRow(id);
    if (!current) return false;
    const oldConfig = safeJson<Record<string, unknown>>(current.config, {});
    const result = this.context.db.update(agents).set({
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      avatar: input.avatar ?? current.avatar,
      config: JSON.stringify({ ...oldConfig, ...input.config }),
      updatedAt: Date.now(),
    }).where(eq(agents.id, id)).run();
    return result.changes > 0;
  }

  createConversation(title: string, type = "dm", agentId?: string): Conversation {
    const id = randomUUID();
    const now = Date.now();
    this.context.db.insert(conversations).values({ id, title, type, createdAt: now, updatedAt: now }).run();
    if (agentId) this.context.db.insert(conversationAgents).values({ conversationId: id, agentId }).run();
    return {
      id,
      title,
      type: type as Conversation["type"],
      agentIds: agentId ? [agentId] : [],
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  ensureDefaultConversation(agentId: string): Conversation {
    const existingLink = this.context.db.select().from(conversationAgents)
      .where(eq(conversationAgents.agentId, agentId)).limit(1).get();
    if (existingLink) {
      const existing = this.getConversation(existingLink.conversationId);
      if (existing) return existing;
    }
    return this.createConversation("New conversation", "dm", agentId);
  }

  listConversations(filter: { archived?: boolean } = {}): Conversation[] {
    const archived = filter.archived ?? false;
    const rows = this.context.db.select().from(conversations)
      .where(eq(conversations.archived, archived))
      .orderBy(desc(conversations.pinned), desc(conversations.updatedAt)).all();
    return rows.map((row) => this.toConversation(row));
  }

  getConversation(id: string): Conversation | undefined {
    const row = this.context.db.select().from(conversations).where(eq(conversations.id, id)).get();
    return row ? this.toConversation(row) : undefined;
  }

  updateConversation(
    id: string,
    input: { title?: string; pinned?: boolean; archived?: boolean },
  ): Conversation | undefined {
    if (!this.getConversation(id)) return undefined;
    this.context.db.update(conversations).set({
      ...input,
      updatedAt: Date.now(),
    }).where(eq(conversations.id, id)).run();
    return this.getConversation(id);
  }

  deleteConversation(id: string): boolean {
    const transaction = this.context.sqlite.transaction(() => {
      this.context.db.delete(messages).where(eq(messages.conversationId, id)).run();
      this.context.db.delete(conversationAgents).where(eq(conversationAgents.conversationId, id)).run();
      return this.context.db.delete(conversations).where(eq(conversations.id, id)).run().changes > 0;
    });
    return transaction();
  }

  deleteConversations(ids: string[]): number {
    const uniqueIds = [...new Set(ids)];
    const transaction = this.context.sqlite.transaction(() => {
      let deleted = 0;
      for (const id of uniqueIds) {
        if (this.deleteConversation(id)) deleted += 1;
      }
      return deleted;
    });
    return transaction();
  }

  listMessages(conversationId: string, limit = 200, before?: number): Message[] {
    const conditions = [eq(messages.conversationId, conversationId)];
    if (before) conditions.push(lt(messages.createdAt, before));
    const rows = this.context.db.select().from(messages)
      .where(and(...conditions)).orderBy(desc(messages.createdAt)).limit(Math.min(Math.max(limit, 1), 500)).all();
    return rows.reverse().map(toMessage);
  }

  listAllMessages(conversationId: string): Message[] {
    return this.context.db.select().from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt)).all().map(toMessage);
  }

  saveMessage(message: Message): void {
    this.context.db.insert(messages).values({
      id: message.id,
      conversationId: message.conversationId,
      fromType: message.fromType,
      fromId: message.fromId,
      toType: message.toType,
      toId: message.toId,
      content: message.content,
      threadId: message.threadId,
      parentId: message.parentId,
      status: message.status,
      metadata: message.metadata ? JSON.stringify(message.metadata) : null,
      createdAt: message.timestamp,
    }).run();
    this.touchConversation(message.conversationId);
  }

  updateMessage(id: string, content: string, status: MessageStatus, metadata?: Message["metadata"]): void {
    this.context.db.update(messages).set({
      content,
      status,
      metadata: metadata ? JSON.stringify(metadata) : null,
    }).where(eq(messages.id, id)).run();
  }

  getSetting(key: string): string | undefined {
    return this.context.db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value;
  }

  setSetting(key: string, value: string): void {
    const now = Date.now();
    this.context.db.insert(appSettings).values({ key, value, updatedAt: now }).onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: now },
    }).run();
  }

  private touchConversation(id: string): void {
    this.context.db.update(conversations).set({ updatedAt: Date.now() }).where(eq(conversations.id, id)).run();
  }

  private toConversation(row: typeof conversations.$inferSelect): Conversation {
    const links = this.context.db.select().from(conversationAgents)
      .where(eq(conversationAgents.conversationId, row.id)).all();
    const latest = this.context.db.select().from(messages)
      .where(eq(messages.conversationId, row.id)).orderBy(desc(messages.createdAt)).limit(1).get();
    return {
      id: row.id,
      title: row.title ?? "Untitled",
      type: row.type as Conversation["type"],
      agentIds: links.map((link) => link.agentId),
      pinned: row.pinned,
      archived: row.archived,
      lastMessage: latest?.content,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

function toPersistedAgent(agent: AgentConfig | PersistedAgentConfig): PersistedAgentConfig {
  const persisted = agent as Partial<PersistedAgentConfig>;
  return {
    ...agent,
    source: persisted.source ?? "user",
    managed: persisted.managed ?? false,
    customizedFields: persisted.customizedFields ?? [],
    catalogEntryId: persisted.catalogEntryId,
    detectionFingerprint: persisted.detectionFingerprint,
    disabled: persisted.disabled ?? false,
  };
}

function safeJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function toMessage(row: typeof messages.$inferSelect): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    fromType: row.fromType as Message["fromType"],
    fromId: row.fromId,
    toType: row.toType as Message["toType"],
    toId: row.toId ?? undefined,
    content: row.content,
    threadId: row.threadId ?? undefined,
    parentId: row.parentId ?? undefined,
    status: row.status as MessageStatus,
    metadata: safeJson(row.metadata, undefined),
    timestamp: row.createdAt,
  };
}
