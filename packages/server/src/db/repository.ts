import { randomUUID } from "node:crypto";
import type {
  Agent,
  AgentConfig,
  AgentStatus,
  Conversation,
  ConversationType,
  Message,
  MessageStatus,
  PersistedAgentConfig,
} from "@agentlink/shared";
import { and, asc, desc, eq, lt } from "drizzle-orm";
import type { DatabaseContext } from "./index";
import {
  agentFriends,
  agents,
  appSettings,
  conversationAgents,
  conversations,
  messages,
  scheduledTasks,
} from "./schema";

export class Repository {
  private agentStatusResolver: (agentId: string) => AgentStatus = () => "offline";

  constructor(readonly context: DatabaseContext) {}

  setAgentStatusResolver(resolver: (agentId: string) => AgentStatus): void {
    this.agentStatusResolver = resolver;
  }

  upsertAgent(
    agent: AgentConfig | PersistedAgentConfig,
    credentialRef?: string | null,
  ): void {
    const now = Date.now();
    const persisted = toPersistedAgent(agent);
    this.context.db.insert(agents).values({
      id: persisted.id,
      name: persisted.name,
      description: persisted.description ?? "",
      avatar: persisted.avatar,
      type: persisted.type,
      config: JSON.stringify(persisted.config),
      credentialRef,
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
        ...(credentialRef !== undefined ? { credentialRef } : {}),
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

  clearAgentCredentialRefs(): void {
    this.context.db.update(agents).set({ credentialRef: null, updatedAt: Date.now() }).run();
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
      this.context.db.delete(agentFriends).where(eq(agentFriends.agentId, id)).run();
      this.context.db.delete(agentFriends).where(eq(agentFriends.friendId, id)).run();
      this.context.db.delete(scheduledTasks).where(eq(scheduledTasks.agentId, id)).run();
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

  listAgentFriends() {
    return this.context.db.select().from(agentFriends).orderBy(asc(agentFriends.createdAt)).all();
  }

  addAgentFriend(agentId: string, friendId: string): void {
    const createdAt = Date.now();
    const transaction = this.context.sqlite.transaction(() => {
      this.context.db.insert(agentFriends).values({ agentId, friendId, createdAt })
        .onConflictDoNothing().run();
      this.context.db.insert(agentFriends).values({ agentId: friendId, friendId: agentId, createdAt })
        .onConflictDoNothing().run();
    });
    transaction();
  }

  removeAgentFriend(agentId: string, friendId: string): void {
    const transaction = this.context.sqlite.transaction(() => {
      this.context.db.delete(agentFriends).where(and(
        eq(agentFriends.agentId, agentId),
        eq(agentFriends.friendId, friendId),
      )).run();
      this.context.db.delete(agentFriends).where(and(
        eq(agentFriends.agentId, friendId),
        eq(agentFriends.friendId, agentId),
      )).run();
    });
    transaction();
  }

  listScheduledTasks() {
    return this.context.db.select().from(scheduledTasks).orderBy(asc(scheduledTasks.createdAt)).all();
  }

  getScheduledTask(id: string) {
    return this.context.db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).get();
  }

  saveScheduledTask(task: typeof scheduledTasks.$inferInsert): void {
    this.context.db.insert(scheduledTasks).values(task).run();
  }

  setScheduledTaskEnabled(id: string, enabled: boolean): boolean {
    return this.context.db.update(scheduledTasks).set({ enabled })
      .where(eq(scheduledTasks.id, id)).run().changes > 0;
  }

  deleteScheduledTask(id: string): boolean {
    return this.context.db.delete(scheduledTasks).where(eq(scheduledTasks.id, id)).run().changes > 0;
  }

  createConversation(title: string, type = "dm", agentIds: string[] = []): Conversation {
    const id = randomUUID();
    const now = Date.now();
    const uniqueAgentIds = [...new Set(agentIds)];
    const transaction = this.context.sqlite.transaction(() => {
      this.context.db.insert(conversations).values({ id, title, type, createdAt: now, updatedAt: now }).run();
      if (uniqueAgentIds.length > 0) {
        this.context.db.insert(conversationAgents).values(
          uniqueAgentIds.map((agentId, position) => ({ conversationId: id, agentId, position })),
        ).run();
      }
    });
    transaction();
    return {
      id,
      title,
      type: type as Conversation["type"],
      agentIds: uniqueAgentIds,
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
    return this.createConversation("New conversation", "dm", [agentId]);
  }

  addAgentToConversation(conversationId: string, agentId: string): Conversation | undefined {
    return this.addAgentsToConversation(conversationId, [agentId]);
  }

  removeAgentFromConversation(conversationId: string, agentId: string): Conversation | undefined {
    return this.removeAgentsFromConversation(conversationId, [agentId]);
  }

  getConversationMembers(conversationId: string): Agent[] {
    const rows = this.context.db.select({ agent: agents }).from(conversationAgents)
      .innerJoin(agents, eq(conversationAgents.agentId, agents.id))
      .where(eq(conversationAgents.conversationId, conversationId))
      .orderBy(asc(conversationAgents.position)).all();
    return rows.map(({ agent }) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description ?? "",
      avatar: agent.avatar ?? undefined,
      type: agent.type as Agent["type"],
      status: this.agentStatusResolver(agent.id),
      model: String(safeJson<Record<string, unknown>>(agent.config, {}).model ?? ""),
      disabled: agent.disabled,
      catalogEntryId: agent.catalogEntryId ?? undefined,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    }));
  }

  addAgentsToConversation(conversationId: string, agentIds: string[]): Conversation | undefined {
    const conversation = this.getConversation(conversationId);
    const uniqueAgentIds = [...new Set(agentIds)];
    if (!conversation || uniqueAgentIds.some((agentId) => !this.getAgentRow(agentId))) return undefined;
    if (uniqueAgentIds.length === 0) return conversation;
    const existingLinks = this.context.db.select().from(conversationAgents)
      .where(eq(conversationAgents.conversationId, conversationId)).all();
    const nextPosition = existingLinks.reduce(
      (highest, link) => Math.max(highest, link.position + 1),
      0,
    );
    const transaction = this.context.sqlite.transaction(() => {
      this.context.db.insert(conversationAgents).values(
        uniqueAgentIds.map((agentId, index) => ({
          conversationId,
          agentId,
          position: nextPosition + index,
        })),
      ).onConflictDoNothing().run();
      this.touchConversation(conversationId);
    });
    transaction();
    return this.getConversation(conversationId);
  }

  removeAgentsFromConversation(conversationId: string, agentIds: string[]): Conversation | undefined {
    const conversation = this.getConversation(conversationId);
    const uniqueAgentIds = [...new Set(agentIds)];
    if (!conversation) return undefined;
    if (uniqueAgentIds.length === 0) return conversation;
    const transaction = this.context.sqlite.transaction(() => {
      for (const agentId of uniqueAgentIds) {
        this.context.db.delete(conversationAgents).where(and(
          eq(conversationAgents.conversationId, conversationId),
          eq(conversationAgents.agentId, agentId),
        )).run();
      }
      this.touchConversation(conversationId);
    });
    transaction();
    return this.getConversation(conversationId);
  }

  listConversations(filter: { archived?: boolean; type?: ConversationType } = {}): Conversation[] {
    const archived = filter.archived ?? false;
    const conditions = [eq(conversations.archived, archived)];
    if (filter.type) conditions.push(eq(conversations.type, filter.type));
    const rows = this.context.db.select().from(conversations)
      .where(and(...conditions))
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
      .where(eq(conversationAgents.conversationId, row.id))
      .orderBy(asc(conversationAgents.position)).all();
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
