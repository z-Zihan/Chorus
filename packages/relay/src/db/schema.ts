import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const hubs = sqliteTable("hubs", {
  hubId: text("hub_id").primaryKey(),
  publicKey: text("public_key").notNull(),
  displayName: text("display_name").notNull(),
  online: integer("online", { mode: "boolean" }).notNull().default(false),
  authVersion: integer("auth_version").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const offlineMessages = sqliteTable("offline_messages", {
  id: text("id").primaryKey(),
  toHubId: text("to_hub_id").notNull(),
  envelope: text("envelope").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const roomMembers = sqliteTable(
  "room_members",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    hubId: text("hub_id")
      .notNull()
      .references(() => hubs.hubId, { onDelete: "cascade" }),
    joinedAt: integer("joined_at").notNull(),
  },
  (table) => ({ pk: primaryKey({ columns: [table.roomId, table.hubId] }) }),
);

export const roomInvitations = sqliteTable(
  "room_invitations",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    inviteeHubId: text("invitee_hub_id")
      .notNull()
      .references(() => hubs.hubId, { onDelete: "cascade" }),
    invitedByHubId: text("invited_by_hub_id")
      .notNull()
      .references(() => hubs.hubId, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["pending", "accepted", "declined", "revoked", "expired"],
    })
      .notNull()
      .default("pending"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    respondedAt: integer("responded_at"),
  },
  (table) => ({ pk: primaryKey({ columns: [table.roomId, table.inviteeHubId] }) }),
);
