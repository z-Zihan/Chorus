import { randomUUID } from "node:crypto";
import type {
  Agent,
  AgentConfig,
  AgentStatus,
  A2AMode,
  A2APolicy,
  Conversation,
  ConversationType,
  Message,
  MessageStatus,
  PersistedAgentConfig,
  User,
  UserWithAgents,
} from "@agentlink/shared";
import { and, asc, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { getUserKey, setUserKey } from "../credential-store.js";
import { deriveUserId, generateUserKeyPair } from "../identity/user-keys.js";
import type { TrustedHub, TrustLevel } from "../hub/trust-store.js";
import type { ClientToken } from "../auth/token-store.js";
import type { DatabaseContext } from "./index";
import {
  agentFriends,
  agents,
  appSettings,
  conversationAgents,
  conversations,
  clientTokens,
  messages,
  scheduledTasks,
  trustedHubs,
  users,
} from "./schema";

export interface AgentListFilter {
  ownerId?: string;
  ownerType?: "local" | "remote" | "system";
  includeRemote?: boolean;
  includeDisabled?: boolean;
  status?: AgentStatus;
  capability?: string;
  limit?: number;
  offset?: number;
}

export interface UserListFilter {
  kind?: User["kind"];
}

export class Repository {
  private agentStatusResolver: (agentId: string) => AgentStatus = () => "offline";

  constructor(readonly context: DatabaseContext) {}

  setAgentStatusResolver(resolver: (agentId: string) => AgentStatus): void {
    this.agentStatusResolver = resolver;
  }

  createClientToken(token: ClientToken): void {
    this.context.db
      .insert(clientTokens)
      .values({
        ...token,
        userId: token.userId ?? null,
        scopes: JSON.stringify(token.scopes),
        lastUsedAt: token.lastUsedAt ?? null,
      })
      .run();
  }

  getClientTokenByHash(hash: string): ClientToken | undefined {
    const row = this.context.db.select().from(clientTokens).where(eq(clientTokens.hash, hash)).get();
    return row ? toClientToken(row) : undefined;
  }

  listClientTokens(): ClientToken[] {
    return this.context.db
      .select()
      .from(clientTokens)
      .orderBy(desc(clientTokens.createdAt))
      .all()
      .map(toClientToken);
  }

  updateClientTokenLastUsed(id: string, lastUsedAt: number): boolean {
    return this.context.db
      .update(clientTokens)
      .set({ lastUsedAt })
      .where(eq(clientTokens.id, id))
      .run().changes > 0;
  }

  revokeClientToken(id: string): boolean {
    return this.context.db
      .update(clientTokens)
      .set({ revoked: true })
      .where(eq(clientTokens.id, id))
      .run().changes > 0;
  }

  purgeExpiredClientTokens(now = Date.now()): number {
    return this.context.db.delete(clientTokens).where(lt(clientTokens.expiresAt, now)).run().changes;
  }

  upsertAgent(
    agent: (AgentConfig | PersistedAgentConfig) & {
      ownerId?: string;
      ownerType?: Agent["ownerType"];
      stale?: boolean;
      homeHubId?: string;
    },
    credentialRef?: string | null,
  ): void {
    const now = Date.now();
    const persisted = toPersistedAgent(agent);
    const current = this.getAgentRow(persisted.id);
    const ownerId = agent.ownerId ?? current?.ownerId ?? "usr_local";
    const ownerType = agent.ownerType ?? current?.ownerType ?? "system";
    const capabilities = agent.capabilities ?? safeJson<string[]>(current?.capabilities ?? null, []);
    const stale = agent.stale ?? current?.stale ?? false;
    const homeHubId = agent.homeHubId ?? current?.homeHubId ?? null;
    const storedConfig = ownerType === "remote" ? {} : persisted.config;
    const storedCredentialRef = ownerType === "remote" ? null : credentialRef;
    this.context.db
      .insert(agents)
      .values({
        id: persisted.id,
        name: persisted.name,
        description: persisted.description ?? "",
        avatar: persisted.avatar,
        type: persisted.type,
        config: JSON.stringify(storedConfig),
        credentialRef: storedCredentialRef,
        source: persisted.source,
        managed: persisted.managed,
        customizedFields: JSON.stringify(persisted.customizedFields),
        catalogEntryId: persisted.catalogEntryId,
        detectionFingerprint: persisted.detectionFingerprint,
        disabled: persisted.disabled,
        ownerId,
        ownerType,
        capabilities: JSON.stringify(capabilities),
        stale,
        homeHubId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: agents.id,
        set: {
          name: persisted.name,
          description: persisted.description ?? "",
          avatar: persisted.avatar,
          type: persisted.type,
          config: JSON.stringify(storedConfig),
          ...(ownerType === "remote"
            ? { credentialRef: null }
            : credentialRef !== undefined
              ? { credentialRef: storedCredentialRef }
              : {}),
          source: persisted.source,
          managed: persisted.managed,
          customizedFields: JSON.stringify(persisted.customizedFields),
          catalogEntryId: persisted.catalogEntryId,
          detectionFingerprint: persisted.detectionFingerprint,
          disabled: persisted.disabled,
          ownerId,
          ownerType,
          capabilities: JSON.stringify(capabilities),
          stale,
          homeHubId,
          updatedAt: now,
        },
      })
      .run();
  }

  async getOrCreateLocalUser(name: string): Promise<User> {
    let keyPair = await getUserKey();
    if (!keyPair) {
      keyPair = generateUserKeyPair();
      await setUserKey(keyPair);
    }

    // The stable protocol identity is derived now, while v1 keeps usr_local as its DB alias.
    void deriveUserId(keyPair.publicKey);
    const publicKey = keyPair.publicKey;
    const transaction = this.context.sqlite.transaction(() => {
      let row = this.context.db.select().from(users).where(eq(users.id, "usr_local")).get();
      const now = Date.now();
      if (!row) {
        this.context.db
          .insert(users)
          .values({
            id: "usr_local",
            name,
            publicKey,
            kind: "local",
            createdAt: now,
            updatedAt: now,
            lastSeenAt: now,
          })
          .run();
      } else {
        this.context.db
          .update(users)
          .set({ publicKey, updatedAt: now, lastSeenAt: now })
          .where(eq(users.id, "usr_local"))
          .run();
      }
      this.context.db
        .update(agents)
        .set({ ownerId: "usr_local" })
        .where(isNull(agents.ownerId))
        .run();
      row = this.context.db.select().from(users).where(eq(users.id, "usr_local")).get();
      return toUser(row as NonNullable<typeof row>);
    });
    return transaction();
  }

  listUsers(filter: UserListFilter = {}): User[] {
    const rows = this.context.db.select().from(users).orderBy(asc(users.createdAt)).all();
    return rows
      .filter((row) => !filter.kind || row.kind === filter.kind)
      .map(toUser);
  }

  getUser(id: string): User | undefined {
    const row = this.context.db.select().from(users).where(eq(users.id, id)).get();
    return row ? toUser(row) : undefined;
  }

  listAgents(filter: AgentListFilter = {}): Agent[] {
    const limit = Math.min(Math.max(filter.limit ?? 100, 0), 500);
    const offset = Math.max(filter.offset ?? 0, 0);
    const agents = this.listAgentRows()
      .filter((row) => !filter.ownerId || row.ownerId === filter.ownerId)
      .filter((row) => !filter.ownerType || row.ownerType === filter.ownerType)
      .filter((row) => filter.includeRemote !== false || row.ownerType !== "remote")
      .filter((row) => filter.includeDisabled === true || row.ownerType === "remote" || !row.disabled)
      .map((row) => this.toAgent(row))
      .filter((agent) => !filter.status || agent.status === filter.status)
      .filter((agent) => !filter.capability || agent.capabilities?.includes(filter.capability));
    return agents.slice(offset, offset + limit);
  }

  getUserWithAgents(userId: string): UserWithAgents | undefined {
    const user = this.getUser(userId);
    if (!user) return undefined;
    const userAgents: Agent[] = [];
    let offset = 0;
    while (true) {
      const page = this.listAgents({ ownerId: userId, limit: 500, offset });
      userAgents.push(...page);
      if (page.length < 500) break;
      offset += page.length;
    }
    return { ...user, agents: userAgents, agentCount: userAgents.length };
  }

  upsertRemoteUser(user: User): void {
    this.context.db
      .insert(users)
      .values({
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        hubId: user.hubId,
        publicKey: user.publicKey,
        kind: "remote",
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastSeenAt: user.lastSeenAt,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          name: user.name,
          avatar: user.avatar,
          hubId: user.hubId,
          publicKey: user.publicKey,
          kind: "remote",
          updatedAt: user.updatedAt,
          lastSeenAt: user.lastSeenAt,
        },
      })
      .run();
  }

  getTrustedHub(hubId: string): TrustedHub | undefined {
    const row = this.context.db.select().from(trustedHubs).where(eq(trustedHubs.hubId, hubId)).get();
    return row ? toTrustedHub(row) : undefined;
  }

  upsertTrustedHub(hub: Partial<TrustedHub>): void {
    if (!hub.hubId) throw new Error("hubId is required to persist a trusted Hub");
    const current = this.getTrustedHub(hub.hubId);
    const now = Date.now();
    const merged: TrustedHub = {
      hubId: hub.hubId,
      hubFingerprint: hub.hubFingerprint ?? current?.hubFingerprint ?? "",
      trustLevel: hub.trustLevel ?? current?.trustLevel ?? "pending",
      userId: hub.userId ?? current?.userId,
      userName: hub.userName ?? current?.userName,
      userPublicKey: hub.userPublicKey ?? current?.userPublicKey,
      pairedAt: hub.pairedAt ?? current?.pairedAt,
      lastSeenAt: hub.lastSeenAt ?? current?.lastSeenAt,
      notes: hub.notes ?? current?.notes,
    };
    if (!merged.hubFingerprint) throw new Error("hubFingerprint is required for a new trusted Hub");
    this.context.db
      .insert(trustedHubs)
      .values({
        ...merged,
        userId: merged.userId ?? null,
        userName: merged.userName ?? null,
        userPublicKey: merged.userPublicKey ?? null,
        pairedAt: merged.pairedAt ?? null,
        lastSeenAt: merged.lastSeenAt ?? null,
        notes: merged.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: trustedHubs.hubId,
        set: {
          hubFingerprint: merged.hubFingerprint,
          userId: merged.userId ?? null,
          userName: merged.userName ?? null,
          userPublicKey: merged.userPublicKey ?? null,
          trustLevel: merged.trustLevel,
          pairedAt: merged.pairedAt ?? null,
          lastSeenAt: merged.lastSeenAt ?? null,
          notes: merged.notes ?? null,
          updatedAt: now,
        },
      })
      .run();
  }

  listTrustedHubs(): TrustedHub[] {
    return this.context.db
      .select()
      .from(trustedHubs)
      .orderBy(asc(trustedHubs.createdAt))
      .all()
      .map(toTrustedHub);
  }

  removeTrustedHub(hubId: string): void {
    this.context.db.delete(trustedHubs).where(eq(trustedHubs.hubId, hubId)).run();
  }

  setHubTrustLevel(hubId: string, level: TrustLevel): void {
    this.context.db
      .update(trustedHubs)
      .set({ trustLevel: level, updatedAt: Date.now() })
      .where(eq(trustedHubs.hubId, hubId))
      .run();
  }

  getAgentRow(id: string) {
    return this.context.db.select().from(agents).where(eq(agents.id, id)).get();
  }

  listAgentRows() {
    return this.context.db.select().from(agents).orderBy(asc(agents.createdAt)).all();
  }

  setRemoteAgentsDisabled(hubId: string, disabled: boolean): string[] {
    const rows = this.context.db
      .select({ id: agents.id })
      .from(agents)
      .innerJoin(users, eq(agents.ownerId, users.id))
      .where(and(eq(agents.ownerType, "remote"), eq(users.hubId, hubId)))
      .all();
    const ids = rows.map(({ id }) => id);
    if (ids.length > 0) {
      this.context.db
        .update(agents)
        .set({ disabled, stale: disabled, updatedAt: Date.now() })
        .where(inArray(agents.id, ids))
        .run();
    }
    return ids;
  }

  private toAgent(row: typeof agents.$inferSelect): Agent {
    const owner = row.ownerId ? this.getUser(row.ownerId) : undefined;
    const capabilities = safeJson<unknown[]>(row.capabilities, []).filter(
      (capability): capability is string => typeof capability === "string",
    );
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      avatar: row.avatar ?? undefined,
      type: row.type as Agent["type"],
      status: this.agentStatusResolver(row.id),
      model: String(safeJson<Record<string, unknown>>(row.config, {}).model ?? ""),
      disabled: row.disabled,
      catalogEntryId: row.catalogEntryId ?? undefined,
      ownerId: row.ownerId ?? undefined,
      ownerType: row.ownerType as Agent["ownerType"],
      owner: owner ? { id: owner.id, name: owner.name, kind: owner.kind } : undefined,
      capabilities,
      stale: row.ownerType === "remote" ? row.stale : false,
      homeHubId: row.homeHubId ?? owner?.hubId ?? "",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  clearAgentCredentialRefs(): void {
    this.context.db.update(agents).set({ credentialRef: null, updatedAt: Date.now() }).run();
  }

  deleteAgent(id: string): boolean {
    const agent = this.getAgentRow(id);
    if (!agent) return false;
    const transaction = this.context.sqlite.transaction(() => {
      const authoredMessages = this.context.db
        .select()
        .from(messages)
        .where(eq(messages.fromId, id))
        .all();
      for (const message of authoredMessages) {
        const metadata = safeJson<Record<string, unknown>>(message.metadata, {});
        this.context.db
          .update(messages)
          .set({
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
          })
          .where(eq(messages.id, message.id))
          .run();
      }
      this.context.db.delete(agentFriends).where(eq(agentFriends.agentId, id)).run();
      this.context.db.delete(agentFriends).where(eq(agentFriends.friendId, id)).run();
      this.context.db.delete(scheduledTasks).where(eq(scheduledTasks.agentId, id)).run();
      this.context.db.delete(conversationAgents).where(eq(conversationAgents.agentId, id)).run();
      return this.context.db.delete(agents).where(eq(agents.id, id)).run().changes > 0;
    });
    return transaction();
  }

  updateAgent(
    id: string,
    input: Partial<Pick<AgentConfig, "name" | "description" | "avatar" | "config">>,
  ): boolean {
    const current = this.getAgentRow(id);
    if (!current) return false;
    const oldConfig = safeJson<Record<string, unknown>>(current.config, {});
    const result = this.context.db
      .update(agents)
      .set({
        name: input.name ?? current.name,
        description: input.description ?? current.description,
        avatar: input.avatar ?? current.avatar,
        config: JSON.stringify({ ...oldConfig, ...input.config }),
        updatedAt: Date.now(),
      })
      .where(eq(agents.id, id))
      .run();
    return result.changes > 0;
  }

  listAgentFriends() {
    return this.context.db.select().from(agentFriends).orderBy(asc(agentFriends.createdAt)).all();
  }

  addAgentFriend(agentId: string, friendId: string): void {
    const createdAt = Date.now();
    const transaction = this.context.sqlite.transaction(() => {
      this.context.db
        .insert(agentFriends)
        .values({ agentId, friendId, createdAt })
        .onConflictDoNothing()
        .run();
      this.context.db
        .insert(agentFriends)
        .values({ agentId: friendId, friendId: agentId, createdAt })
        .onConflictDoNothing()
        .run();
    });
    transaction();
  }

  removeAgentFriend(agentId: string, friendId: string): void {
    const transaction = this.context.sqlite.transaction(() => {
      this.context.db
        .delete(agentFriends)
        .where(and(eq(agentFriends.agentId, agentId), eq(agentFriends.friendId, friendId)))
        .run();
      this.context.db
        .delete(agentFriends)
        .where(and(eq(agentFriends.agentId, friendId), eq(agentFriends.friendId, agentId)))
        .run();
    });
    transaction();
  }

  listScheduledTasks() {
    return this.context.db
      .select()
      .from(scheduledTasks)
      .orderBy(asc(scheduledTasks.createdAt))
      .all();
  }

  getScheduledTask(id: string) {
    return this.context.db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).get();
  }

  saveScheduledTask(task: typeof scheduledTasks.$inferInsert): void {
    this.context.db.insert(scheduledTasks).values(task).run();
  }

  setScheduledTaskEnabled(id: string, enabled: boolean): boolean {
    return (
      this.context.db.update(scheduledTasks).set({ enabled }).where(eq(scheduledTasks.id, id)).run()
        .changes > 0
    );
  }

  deleteScheduledTask(id: string): boolean {
    return (
      this.context.db.delete(scheduledTasks).where(eq(scheduledTasks.id, id)).run().changes > 0
    );
  }

  createConversation(
    title: string,
    type = "dm",
    agentIds: string[] = [],
    relayRoomId?: string,
    metadata?: Conversation["metadata"],
  ): Conversation {
    const id = randomUUID();
    const now = Date.now();
    const uniqueAgentIds = [...new Set(agentIds)];
    const transaction = this.context.sqlite.transaction(() => {
      this.context.db
        .insert(conversations)
        .values({
          id,
          title,
          type,
          relayRoomId,
          metadata: metadata ? JSON.stringify(metadata) : null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      if (uniqueAgentIds.length > 0) {
        this.context.db
          .insert(conversationAgents)
          .values(this.buildConversationMemberSnapshots(id, uniqueAgentIds, 0, now))
          .run();
      }
    });
    transaction();
    return {
      id,
      title,
      type: type as Conversation["type"],
      agentIds: uniqueAgentIds,
      a2aMode: "mention",
      a2aPolicy: "auto",
      pinned: false,
      archived: false,
      relayRoomId,
      metadata,
      createdAt: now,
      updatedAt: now,
    };
  }

  ensureDefaultConversation(agentId: string): Conversation {
    const existingLink = this.context.db
      .select()
      .from(conversationAgents)
      .where(eq(conversationAgents.agentId, agentId))
      .limit(1)
      .get();
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

  getConversationMembers(conversationId: string): Array<
    Agent & {
      agentNameSnapshot?: string;
      ownerNameSnapshot?: string;
      hubIdSnapshot?: string;
      joinedAt: number;
    }
  > {
    const rows = this.context.db
      .select({ agent: agents, membership: conversationAgents })
      .from(conversationAgents)
      .innerJoin(agents, eq(conversationAgents.agentId, agents.id))
      .where(eq(conversationAgents.conversationId, conversationId))
      .orderBy(asc(conversationAgents.position))
      .all();
    return rows.map(({ agent, membership }) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description ?? "",
      avatar: agent.avatar ?? undefined,
      type: agent.type as Agent["type"],
      status: this.agentStatusResolver(agent.id),
      model: String(safeJson<Record<string, unknown>>(agent.config, {}).model ?? ""),
      disabled: agent.disabled,
      catalogEntryId: agent.catalogEntryId ?? undefined,
      ownerId: membership.ownerId ?? undefined,
      ownerType: agent.ownerType as Agent["ownerType"],
      agentNameSnapshot: membership.agentNameSnapshot ?? undefined,
      ownerNameSnapshot: membership.ownerNameSnapshot ?? undefined,
      hubIdSnapshot: membership.hubIdSnapshot ?? undefined,
      joinedAt: membership.joinedAt,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    }));
  }

  addAgentsToConversation(conversationId: string, agentIds: string[]): Conversation | undefined {
    const conversation = this.getConversation(conversationId);
    const uniqueAgentIds = [...new Set(agentIds)];
    if (!conversation || uniqueAgentIds.some((agentId) => !this.getAgentRow(agentId)))
      return undefined;
    if (uniqueAgentIds.length === 0) return conversation;
    const existingLinks = this.context.db
      .select()
      .from(conversationAgents)
      .where(eq(conversationAgents.conversationId, conversationId))
      .all();
    const nextPosition = existingLinks.reduce(
      (highest, link) => Math.max(highest, link.position + 1),
      0,
    );
    const transaction = this.context.sqlite.transaction(() => {
      this.context.db
        .insert(conversationAgents)
        .values(
          this.buildConversationMemberSnapshots(
            conversationId,
            uniqueAgentIds,
            nextPosition,
            Date.now(),
          ),
        )
        .onConflictDoNothing()
        .run();
      this.touchConversation(conversationId);
    });
    transaction();
    return this.getConversation(conversationId);
  }

  removeAgentsFromConversation(
    conversationId: string,
    agentIds: string[],
  ): Conversation | undefined {
    const conversation = this.getConversation(conversationId);
    const uniqueAgentIds = [...new Set(agentIds)];
    if (!conversation) return undefined;
    if (uniqueAgentIds.length === 0) return conversation;
    const transaction = this.context.sqlite.transaction(() => {
      for (const agentId of uniqueAgentIds) {
        this.context.db
          .delete(conversationAgents)
          .where(
            and(
              eq(conversationAgents.conversationId, conversationId),
              eq(conversationAgents.agentId, agentId),
            ),
          )
          .run();
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
    const rows = this.context.db
      .select()
      .from(conversations)
      .where(and(...conditions))
      .orderBy(desc(conversations.pinned), desc(conversations.updatedAt))
      .all();
    return rows.map((row) => this.toConversation(row));
  }

  getConversation(id: string): Conversation | undefined {
    const row = this.context.db.select().from(conversations).where(eq(conversations.id, id)).get();
    return row ? this.toConversation(row) : undefined;
  }

  updateConversation(
    id: string,
    input: {
      title?: string;
      pinned?: boolean;
      archived?: boolean;
      a2aMode?: A2AMode;
      a2aPolicy?: A2APolicy;
    },
  ): Conversation | undefined {
    if (!this.getConversation(id)) return undefined;
    this.context.db
      .update(conversations)
      .set({
        ...input,
        updatedAt: Date.now(),
      })
      .where(eq(conversations.id, id))
      .run();
    return this.getConversation(id);
  }

  deleteConversation(id: string): boolean {
    const transaction = this.context.sqlite.transaction(() => {
      this.context.db.delete(messages).where(eq(messages.conversationId, id)).run();
      this.context.db
        .delete(conversationAgents)
        .where(eq(conversationAgents.conversationId, id))
        .run();
      return (
        this.context.db.delete(conversations).where(eq(conversations.id, id)).run().changes > 0
      );
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
    const rows = this.context.db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt))
      .limit(Math.min(Math.max(limit, 1), 500))
      .all();
    return rows.reverse().map(toMessage);
  }

  listAllMessages(conversationId: string): Message[] {
    return this.context.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt))
      .all()
      .map(toMessage);
  }

  saveMessage(message: Message): void {
    this.context.db
      .insert(messages)
      .values({
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
      })
      .run();
    this.touchConversation(message.conversationId);
  }

  updateMessage(
    id: string,
    content: string,
    status: MessageStatus,
    metadata?: Message["metadata"],
  ): void {
    this.context.db
      .update(messages)
      .set({
        content,
        status,
        metadata: metadata ? JSON.stringify(metadata) : null,
      })
      .where(eq(messages.id, id))
      .run();
  }

  getSetting(key: string): string | undefined {
    return this.context.db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value;
  }

  setSetting(key: string, value: string): void {
    const now = Date.now();
    this.context.db
      .insert(appSettings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: now },
      })
      .run();
  }

  private touchConversation(id: string): void {
    this.context.db
      .update(conversations)
      .set({ updatedAt: Date.now() })
      .where(eq(conversations.id, id))
      .run();
  }

  private buildConversationMemberSnapshots(
    conversationId: string,
    agentIds: string[],
    startPosition: number,
    joinedAt: number,
  ): Array<typeof conversationAgents.$inferInsert> {
    return agentIds.map((agentId, index) => {
      const agent = this.getAgentRow(agentId);
      if (!agent) throw new Error(`Agent not found: ${agentId}`);
      const owner = agent.ownerId
        ? this.context.db.select().from(users).where(eq(users.id, agent.ownerId)).get()
        : undefined;
      return {
        conversationId,
        agentId,
        position: startPosition + index,
        ownerId: agent.ownerId,
        agentNameSnapshot: agent.name,
        ownerNameSnapshot: owner?.name,
        hubIdSnapshot: owner?.hubId,
        joinedAt,
      };
    });
  }

  private toConversation(row: typeof conversations.$inferSelect): Conversation {
    const links = this.context.db
      .select()
      .from(conversationAgents)
      .where(eq(conversationAgents.conversationId, row.id))
      .orderBy(asc(conversationAgents.position))
      .all();
    const latest = this.context.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, row.id))
      .orderBy(desc(messages.createdAt))
      .limit(1)
      .get();
    return {
      id: row.id,
      title: row.title ?? "Untitled",
      type: row.type as Conversation["type"],
      a2aMode: row.a2aMode as A2AMode,
      a2aPolicy: row.a2aPolicy as A2APolicy,
      agentIds: links.map((link) => link.agentId),
      pinned: row.pinned,
      archived: row.archived,
      relayRoomId: row.relayRoomId ?? undefined,
      metadata: safeJson(row.metadata, undefined),
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
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
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

function toUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar ?? undefined,
    hubId: row.hubId ?? undefined,
    publicKey: row.publicKey ?? undefined,
    kind: row.kind as User["kind"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastSeenAt: row.lastSeenAt ?? undefined,
  };
}

function toTrustedHub(row: typeof trustedHubs.$inferSelect): TrustedHub {
  return {
    hubId: row.hubId,
    hubFingerprint: row.hubFingerprint,
    userId: row.userId ?? undefined,
    userName: row.userName ?? undefined,
    userPublicKey: row.userPublicKey ?? undefined,
    trustLevel: row.trustLevel as TrustLevel,
    pairedAt: row.pairedAt ?? undefined,
    lastSeenAt: row.lastSeenAt ?? undefined,
    notes: row.notes ?? undefined,
  };
}

function toClientToken(row: typeof clientTokens.$inferSelect): ClientToken {
  return {
    id: row.id,
    hash: row.hash,
    clientId: row.clientId,
    userId: row.userId ?? undefined,
    scopes: safeJson<unknown[]>(row.scopes, []).filter(
      (scope): scope is string => typeof scope === "string",
    ),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? undefined,
    revoked: row.revoked,
  };
}
