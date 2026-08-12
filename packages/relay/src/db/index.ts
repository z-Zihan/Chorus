import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export function createDatabase(dbPath: string) {
  const resolvedPath = resolve(dbPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });

  const sqlite = new Database(resolvedPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = FULL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS hubs (
      hub_id TEXT PRIMARY KEY,
      public_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      online INTEGER NOT NULL DEFAULT 0 CHECK (online IN (0, 1)),
      auth_version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS offline_messages (
      id TEXT PRIMARY KEY,
      to_hub_id TEXT NOT NULL,
      envelope TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_offline_messages_recipient
      ON offline_messages (to_hub_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_offline_messages_expiry
      ON offline_messages (expires_at);

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (room_id, hub_id)
    );

    CREATE TABLE IF NOT EXISTS room_invitations (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      invitee_hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE,
      invited_by_hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      responded_at INTEGER,
      PRIMARY KEY (room_id, invitee_hub_id)
    );

    CREATE INDEX IF NOT EXISTS idx_room_invitations_invitee
      ON room_invitations (invitee_hub_id, status, created_at);

    CREATE TABLE IF NOT EXISTS hub_blocks (
      hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE,
      blocked_hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (hub_id, blocked_hub_id)
    );
  `);

  const hubColumns = sqlite.prepare("PRAGMA table_info(hubs)").all() as Array<{ name: string }>;
  if (!hubColumns.some(({ name }) => name === "auth_version")) {
    sqlite.exec("ALTER TABLE hubs ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1");
  }

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

export type DatabaseContext = ReturnType<typeof createDatabase>;
