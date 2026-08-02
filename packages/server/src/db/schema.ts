import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  avatar: text("avatar"),
  type: text("type").notNull(),
  config: text("config"),
  source: text("source").notNull().default("user"),
  managed: integer("managed", { mode: "boolean" }).notNull().default(false),
  customizedFields: text("customized_fields").notNull().default("[]"),
  catalogEntryId: text("catalog_entry_id"),
  detectionFingerprint: text("detection_fingerprint"),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title"),
  type: text("type").notNull().default("dm"),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const conversationAgents = sqliteTable(
  "conversation_agents",
  {
    conversationId: text("conversation_id").notNull().references(() => conversations.id),
    agentId: text("agent_id").notNull().references(() => agents.id),
  },
  (table) => ({ pk: primaryKey({ columns: [table.conversationId, table.agentId] }) }),
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id),
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
