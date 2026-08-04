import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  avatar: text("avatar"),
  hubId: text("hub_id"),
  publicKey: text("public_key"),
  kind: text("kind").notNull().default("local"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  lastSeenAt: integer("last_seen_at"),
});

export const trustedHubs = sqliteTable("trusted_hubs", {
  hubId: text("hub_id").primaryKey(),
  hubFingerprint: text("hub_fingerprint").notNull(),
  userId: text("user_id"),
  userName: text("user_name"),
  userPublicKey: text("user_public_key"),
  trustLevel: text("trust_level").notNull().default("pending"),
  pairedAt: integer("paired_at"),
  lastSeenAt: integer("last_seen_at"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  avatar: text("avatar"),
  type: text("type").notNull(),
  config: text("config"),
  credentialRef: text("credential_ref"),
  source: text("source").notNull().default("user"),
  managed: integer("managed", { mode: "boolean" }).notNull().default(false),
  customizedFields: text("customized_fields").notNull().default("[]"),
  catalogEntryId: text("catalog_entry_id"),
  detectionFingerprint: text("detection_fingerprint"),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  ownerId: text("owner_id").references(() => users.id),
  ownerType: text("owner_type").notNull().default("system"),
  capabilities: text("capabilities").notNull().default("[]"),
  stale: integer("stale", { mode: "boolean" }).notNull().default(false),
  homeHubId: text("home_hub_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const clientTokens = sqliteTable("client_tokens", {
  id: text("id").primaryKey(),
  hash: text("hash").notNull().unique(),
  clientId: text("client_id").notNull(),
  userId: text("user_id"),
  scopes: text("scopes").notNull().default("[]"),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
  revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title"),
  type: text("type").notNull().default("dm"),
  a2aMode: text("a2a_mode").notNull().default("mention"),
  a2aPolicy: text("a2a_policy").notNull().default("auto"),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  relayRoomId: text("relay_room_id"),
  metadata: text("metadata"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const conversationAgents = sqliteTable(
  "conversation_agents",
  {
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    position: integer("position").notNull().default(0),
    ownerId: text("owner_id"),
    agentNameSnapshot: text("agent_name_snapshot"),
    ownerNameSnapshot: text("owner_name_snapshot"),
    hubIdSnapshot: text("hub_id_snapshot"),
    joinedAt: integer("joined_at").notNull().default(0),
  },
  (table) => ({ pk: primaryKey({ columns: [table.conversationId, table.agentId] }) }),
);

export const agentFriends = sqliteTable(
  "agent_friends",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    friendId: text("friend_id")
      .notNull()
      .references(() => agents.id),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.agentId, table.friendId] }) }),
);

export const scheduledTasks = sqliteTable("scheduled_tasks", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id),
  cronExpression: text("cron_expression").notNull(),
  prompt: text("prompt").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id),
    fromType: text("from_type").notNull(),
    fromId: text("from_id").notNull(),
    toType: text("to_type"),
    toId: text("to_id"),
    content: text("content").notNull(),
    threadId: text("thread_id"),
    parentId: text("parent_id"),
    status: text("status").notNull().default("done"),
    metadata: text("metadata"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    conversationIdx: index("idx_messages_conversation").on(table.conversationId, table.createdAt),
    threadIdx: index("idx_messages_thread").on(table.threadId),
    parentIdx: index("idx_messages_parent").on(table.parentId),
  }),
);
