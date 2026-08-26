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
  PersistedRoomState,
  PersistedAgentConfig,
  RoomStateEvent,
  User,
  UserWithAgents,
} from "@chorus/shared";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
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
  roomStateEvents,
  scheduledTasks,
  trustedHubs,
  userHubs,
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

export interface UserHub {
  id: string;
  userId: string;
  hubId: string;
  hubDisplayName?: string;
  bound: boolean;
  createdAt: number;
  updatedAt: number;
  lastSeenAt?: number;
}

export interface UserHubSummary {
  hubId: string;
  displayName: string | null;
  lastSeenAt: number | null;
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
    const row = this.context.db
      .select()
      .from(clientTokens)
      .where(eq(clientTokens.hash, hash))
      .get();
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
    return (
      this.context.db.update(clientTokens).set({ lastUsedAt }).where(eq(clientTokens.id, id)).run()
        .changes > 0
    );
  }

  revokeClientToken(id: string): boolean {
    return (
      this.context.db
        .update(clientTokens)
        .set({ revoked: true })
        .where(eq(clientTokens.id, id))
        .run().changes > 0
    );
  }

  purgeExpiredClientTokens(now = Date.now()): number {
    return this.context.db.delete(clientTokens).where(lt(clientTokens.expiresAt, now)).run()
      .changes;
  }

  upsertAgent(
    agent: (AgentConfig | PersistedAgentConfig) & {
      ownerId?: string;
      ownerType?: Agent["ownerType"];
      stale?: boolean;
      homeHubId?: string;
      visibility?: Agent["visibility"];
    },
    credentialRef?: string | null,
  ): void {
    const now = Date.now();
    const persisted = toPersistedAgent(agent);
    const current = this.getAgentRow(persisted.id);
    const ownerId = agent.ownerId ?? current?.ownerId ?? "usr_local";
    const ownerType = agent.ownerType ?? current?.ownerType ?? "system";
    const capabilities =
      agent.capabilities ?? safeJson<string[]>(current?.capabilities ?? null, []);
    const stale = agent.stale ?? current?.stale ?? false;
    const homeHubId = agent.homeHubId ?? current?.homeHubId ?? null;
    const visibility =
      agent.visibility ?? (current?.visibility as Agent["visibility"] | undefined) ?? "private";
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
        visibility,
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
          visibility,
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

  /** Keep the protocol user's display name aligned with the Hub display name. */
  renameLocalUser(name: string): User | undefined {
    const trimmed = name.trim();
    if (!trimmed) return undefined;
    this.context.db
      .update(users)
      .set({ name: trimmed, updatedAt: Date.now() })
      .where(eq(users.id, "usr_local"))
      .run();
    return this.getUser("usr_local");
  }

  listUsers(filter: UserListFilter = {}): User[] {
    const rows = this.context.db.select().from(users).orderBy(asc(users.createdAt)).all();
    return rows.filter((row) => !filter.kind || row.kind === filter.kind).map(toUser);
  }

  getUser(id: string): User | undefined {
    const row = this.context.db.select().from(users).where(eq(users.id, id)).get();
    return row ? toUser(row) : undefined;
  }

  bindUserHub(userId: string, hubId: string, displayName?: string): UserHub {
    const normalizedHubId = hubId.trim();
    if (!normalizedHubId) throw new Error("hubId must be a non-empty string");
    if (!this.getUser(userId)) throw new Error(`User not found: ${userId}`);

    const now = Date.now();
    const current = this.context.db
      .select()
      .from(userHubs)
      .where(and(eq(userHubs.userId, userId), eq(userHubs.hubId, normalizedHubId)))
      .get();
    if (current) {
      this.context.db
        .update(userHubs)
        .set({
          hubDisplayName: displayName ?? current.hubDisplayName,
          bound: true,
          updatedAt: now,
          lastSeenAt: now,
        })
        .where(eq(userHubs.id, current.id))
        .run();
      return toUserHub({
        ...current,
        hubDisplayName: displayName ?? current.hubDisplayName,
        bound: true,
        updatedAt: now,
        lastSeenAt: now,
      });
    }

    const row: typeof userHubs.$inferInsert = {
      id: randomUUID(),
      userId,
      hubId: normalizedHubId,
      hubDisplayName: displayName ?? null,
      bound: true,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
    this.context.db.insert(userHubs).values(row).run();
    return toUserHub(row as typeof userHubs.$inferSelect);
  }

  unbindUserHub(userId: string, hubId: string): boolean {
    const binding = this.context.db
      .select()
      .from(userHubs)
      .where(and(eq(userHubs.userId, userId), eq(userHubs.hubId, hubId), eq(userHubs.bound, true)))
      .get();
    if (!binding) return false;
    this.context.db
      .update(userHubs)
      .set({ bound: false, updatedAt: Date.now() })
      .where(eq(userHubs.id, binding.id))
      .run();
    this.setRemoteAgentsDisabled(hubId, true);
    return true;
  }

  listUserHubs(userId: string): UserHub[] {
    return this.context.db
      .select()
      .from(userHubs)
      .where(eq(userHubs.userId, userId))
      .orderBy(asc(userHubs.createdAt))
      .all()
      .map(toUserHub);
  }

  listHubsForUser(userId: string): UserHubSummary[] {
    return this.listUserHubs(userId)
      .filter((hub) => hub.bound)
      .map((hub) => ({
        hubId: hub.hubId,
        displayName: hub.hubDisplayName ?? null,
        lastSeenAt: hub.lastSeenAt ?? null,
      }));
  }

  listAgents(filter: AgentListFilter = {}): Agent[] {
    const limit = Math.min(Math.max(filter.limit ?? 100, 0), 500);
    const offset = Math.max(filter.offset ?? 0, 0);
    const agents = this.listAgentRows()
      .filter((row) => !filter.ownerId || row.ownerId === filter.ownerId)
      .filter((row) => !filter.ownerType || row.ownerType === filter.ownerType)
      .filter((row) => filter.includeRemote !== false || row.ownerType !== "remote")
      .filter(
        (row) => filter.includeDisabled === true || row.ownerType === "remote" || !row.disabled,
      )
      .map((row) => this.toAgent(row))
      .filter((agent) => !filter.status || agent.status === filter.status)
      .filter((agent) => !filter.capability || agent.capabilities?.includes(filter.capability));
    return agents.slice(offset, offset + limit);
  }

  getUserWithAgents(userId: string): UserWithAgents | undefined {
    const user = this.getUser(userId);
    if (!user) return undefined;
    const boundHubIds = new Set(this.listHubsForUser(userId).map(({ hubId }) => hubId));
    const userAgents = this.listAgentRows()
      .filter((row) => {
        if (row.ownerType !== "remote") return row.ownerId === userId;
        if (row.homeHubId) return boundHubIds.has(row.homeHubId);
        return row.ownerId === userId;
      })
      .map((row) => this.toAgent(row));
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
    if (user.hubId) this.bindUserHub(user.id, user.hubId);
  }

  getTrustedHub(hubId: string): TrustedHub | undefined {
    const row = this.context.db
      .select()
      .from(trustedHubs)
      .where(eq(trustedHubs.hubId, hubId))
      .get();
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
      .where(and(eq(agents.ownerType, "remote"), eq(agents.homeHubId, hubId)))
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
      visibility: normalizeAgentVisibility(row.visibility),
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

  recordScheduledTaskRun(
    id: string,
    run: { lastRunAt: number; lastResult: string | null; nextRunAt: number | null },
  ): boolean {
    return (
      this.context.db.update(scheduledTasks).set(run).where(eq(scheduledTasks.id, id)).run()
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
    ownerProofs: Record<string, string> = {},
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
          revision: 1,
          keyEpoch: 1,
          managementState: "managed",
          relayRoomId,
          metadata: metadata ? JSON.stringify(metadata) : null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      if (uniqueAgentIds.length > 0) {
        this.context.db
          .insert(conversationAgents)
          .values(this.buildConversationMemberSnapshots(id, uniqueAgentIds, 0, now, ownerProofs))
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

  addAgentToConversation(
    conversationId: string,
    agentIds: string | string[],
    ownerProofs: Record<string, string> = {},
  ): Conversation | undefined {
    return this.addAgentsToConversation(
      conversationId,
      Array.isArray(agentIds) ? agentIds : [agentIds],
      ownerProofs,
    );
  }

  removeAgentFromConversation(conversationId: string, agentId: string): Conversation | undefined {
    return this.removeAgentsFromConversation(conversationId, [agentId]);
  }

  incrementRoomRevision(roomId: string): PersistedRoomState | undefined {
    const result = this.context.db
      .update(conversations)
      .set({
        revision: sql`${conversations.revision} + 1`,
        updatedAt: Date.now(),
      })
      .where(or(eq(conversations.id, roomId), eq(conversations.relayRoomId, roomId)))
      .run();
    return result.changes > 0 ? this.getRoomState(roomId) : undefined;
  }

  incrementRoomKeyEpoch(roomId: string): PersistedRoomState | undefined {
    const result = this.context.db
      .update(conversations)
      .set({
        revision: sql`${conversations.revision} + 1`,
        keyEpoch: sql`${conversations.keyEpoch} + 1`,
        updatedAt: Date.now(),
      })
      .where(or(eq(conversations.id, roomId), eq(conversations.relayRoomId, roomId)))
      .run();
    return result.changes > 0 ? this.getRoomState(roomId) : undefined;
  }

  getRoomState(roomId: string): PersistedRoomState | undefined {
    const row = this.context.db
      .select({
        revision: conversations.revision,
        keyEpoch: conversations.keyEpoch,
        managementState: conversations.managementState,
      })
      .from(conversations)
      .where(or(eq(conversations.id, roomId), eq(conversations.relayRoomId, roomId)))
      .get();
    if (!row) return undefined;
    return {
      revision: row.revision,
      keyEpoch: row.keyEpoch,
      managementState: row.managementState as PersistedRoomState["managementState"],
    };
  }

  listRoomIds(): string[] {
    return this.context.db
      .select({ roomId: conversations.relayRoomId })
      .from(conversations)
      .where(isNotNull(conversations.relayRoomId))
      .all()
      .flatMap(({ roomId }) => (roomId ? [roomId] : []));
  }

  setRoomState(roomId: string, state: PersistedRoomState): PersistedRoomState | undefined {
    if (!isPersistedRoomState(state)) throw new Error("Invalid persisted Room state");
    const result = this.context.db
      .update(conversations)
      .set({
        revision: state.revision,
        keyEpoch: state.keyEpoch,
        managementState: state.managementState,
        updatedAt: Date.now(),
      })
      .where(or(eq(conversations.id, roomId), eq(conversations.relayRoomId, roomId)))
      .run();
    return result.changes > 0 ? this.getRoomState(roomId) : undefined;
  }

  getRoomStateEvents(roomId: string, afterRevision: number, limit = 101): RoomStateEvent[] {
    return this.context.db
      .select()
      .from(roomStateEvents)
      .where(
        and(
          eq(roomStateEvents.roomId, roomId),
          sql`${roomStateEvents.revision} > ${afterRevision}`,
        ),
      )
      .orderBy(asc(roomStateEvents.revision))
      .limit(limit)
      .all()
      .map((row) => ({
        eventId: row.eventId,
        roomId: row.roomId,
        revision: row.revision,
        keyEpoch: row.keyEpoch,
        eventType: row.eventType as RoomStateEvent["eventType"],
        actorUserId: row.actorUserId,
        actorSignature: row.actorSignature,
        timestamp: row.timestamp,
        data: safeJson<Record<string, unknown>>(row.data, {}),
      }));
  }

  saveRoomStateEvent(event: RoomStateEvent): boolean {
    const result = this.context.db
      .insert(roomStateEvents)
      .values({ ...event, data: JSON.stringify(event.data) })
      .onConflictDoNothing()
      .run();
    return result.changes > 0;
  }

  setRoomManagementState(
    roomId: string,
    state: PersistedRoomState["managementState"],
  ): PersistedRoomState | undefined {
    const result = this.context.db
      .update(conversations)
      .set({ managementState: state, updatedAt: Date.now() })
      .where(or(eq(conversations.id, roomId), eq(conversations.relayRoomId, roomId)))
      .run();
    return result.changes > 0 ? this.getRoomState(roomId) : undefined;
  }

  getConversationMembers(conversationId: string): Array<
    Agent & {
      agentNameSnapshot?: string;
      ownerNameSnapshot?: string;
      hubIdSnapshot?: string;
      ownerProof?: string;
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
      visibility: normalizeAgentVisibility(agent.visibility),
      agentNameSnapshot: membership.agentNameSnapshot ?? undefined,
      ownerNameSnapshot: membership.ownerNameSnapshot ?? undefined,
      hubIdSnapshot: membership.hubIdSnapshot ?? undefined,
      ownerProof: membership.ownerProof ?? undefined,
      joinedAt: membership.joinedAt,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    }));
  }

  addAgentsToConversation(
    conversationId: string,
    agentIds: string[],
    ownerProofs: Record<string, string> = {},
  ): Conversation | undefined {
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
            ownerProofs,
          ),
        )
        .onConflictDoNothing()
        .run();
      this.touchConversation(conversationId);
    });
    transaction();
    return this.getConversation(conversationId);
  }

  setConversationAgentOwnerProof(
    conversationId: string,
    agentId: string,
    ownerProof: string,
  ): boolean {
    return (
      this.context.db
        .update(conversationAgents)
        .set({ ownerProof })
        .where(
          and(
            eq(conversationAgents.conversationId, conversationId),
            eq(conversationAgents.agentId, agentId),
          ),
        )
        .run().changes > 0
    );
  }

  getConversationAgentOwnerProof(conversationId: string, agentId: string): string | undefined {
    return (
      this.context.db
        .select({ ownerProof: conversationAgents.ownerProof })
        .from(conversationAgents)
        .where(
          and(
            eq(conversationAgents.conversationId, conversationId),
            eq(conversationAgents.agentId, agentId),
          ),
        )
        .get()?.ownerProof ?? undefined
    );
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
    ownerProofs: Record<string, string> = {},
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
        ownerProof: ownerProofs[agentId],
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

function isPersistedRoomState(value: PersistedRoomState): boolean {
  return (
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    Number.isSafeInteger(value.keyEpoch) &&
    value.keyEpoch >= 1 &&
    (value.managementState === "managed" || value.managementState === "unmanaged")
  );
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

function normalizeAgentVisibility(value: unknown): Agent["visibility"] {
  return value === "room" || value === "public" ? value : "private";
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

function toUserHub(row: typeof userHubs.$inferSelect): UserHub {
  return {
    id: row.id,
    userId: row.userId,
    hubId: row.hubId,
    hubDisplayName: row.hubDisplayName ?? undefined,
    bound: row.bound,
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
