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
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS hubs (
      hub_id TEXT PRIMARY KEY,
      public_key TEXT NOT NULL,
      display_name TEXT NOT NULL,
      online INTEGER NOT NULL DEFAULT 0 CHECK (online IN (0, 1)),
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
  `);

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

export type DatabaseContext = ReturnType<typeof createDatabase>;
