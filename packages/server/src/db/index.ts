import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

function resolveMigrationsFolder(): string {
  const candidates = [
    fileURLToPath(new URL("../../drizzle", import.meta.url)),
    fileURLToPath(new URL(".", import.meta.url)),
    resolve(process.cwd(), "packages/server/drizzle"),
    resolve(process.cwd(), "drizzle"),
  ];

  const migrationsFolder = candidates.find((candidate) =>
    existsSync(resolve(candidate, "meta/_journal.json")),
  );
  if (!migrationsFolder) {
    throw new Error(`Drizzle migrations not found. Checked: ${candidates.join(", ")}`);
  }
  return migrationsFolder;
}

export function createDatabase(dbPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolveMigrationsFolder() });
  ensureCredentialRefColumn(sqlite);
  ensureConversationColumns(sqlite);
  ensureUserColumns(sqlite);
  ensureTrustedHubsTable(sqlite);
  initializeMessageSearch(sqlite);
  return { sqlite, db };
}

function ensureTrustedHubsTable(sqlite: Database.Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS trusted_hubs (
    hub_id TEXT PRIMARY KEY,
    hub_fingerprint TEXT NOT NULL,
    user_id TEXT,
    user_name TEXT,
    user_public_key TEXT,
    trust_level TEXT NOT NULL DEFAULT 'pending',
    paired_at INTEGER,
    last_seen_at INTEGER,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
}

function ensureUserColumns(sqlite: Database.Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    avatar TEXT,
    hub_id TEXT,
    public_key TEXT,
    kind TEXT NOT NULL DEFAULT 'local',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_seen_at INTEGER
  )`);

  const agentColumns = sqlite.prepare("PRAGMA table_info(agents)").all() as Array<{ name: string }>;
  if (!agentColumns.some((column) => column.name === "owner_id")) {
    sqlite.exec("ALTER TABLE agents ADD COLUMN owner_id TEXT REFERENCES users(id)");
  }
  if (!agentColumns.some((column) => column.name === "owner_type")) {
    sqlite.exec("ALTER TABLE agents ADD COLUMN owner_type TEXT NOT NULL DEFAULT 'system'");
  }
}

function ensureCredentialRefColumn(sqlite: Database.Database): void {
  const columns = sqlite.prepare("PRAGMA table_info(agents)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "credential_ref")) {
    sqlite.exec("ALTER TABLE agents ADD COLUMN credential_ref TEXT");
  }
}

function ensureConversationColumns(sqlite: Database.Database): void {
  const conversationColumns = sqlite.prepare("PRAGMA table_info(conversations)").all() as Array<{
    name: string;
  }>;
  if (!conversationColumns.some((column) => column.name === "metadata")) {
    sqlite.exec("ALTER TABLE conversations ADD COLUMN metadata TEXT");
  }
  if (!conversationColumns.some((column) => column.name === "relay_room_id")) {
    sqlite.exec("ALTER TABLE conversations ADD COLUMN relay_room_id TEXT");
  }
  if (!conversationColumns.some((column) => column.name === "a2a_policy")) {
    sqlite.exec("ALTER TABLE conversations ADD COLUMN a2a_policy TEXT NOT NULL DEFAULT 'auto'");
  }
  sqlite.exec("UPDATE conversations SET type = 'group' WHERE type = 'channel'");

  const memberColumns = sqlite.prepare("PRAGMA table_info(conversation_agents)").all() as Array<{
    name: string;
  }>;
  if (!memberColumns.some((column) => column.name === "owner_id")) {
    sqlite.exec("ALTER TABLE conversation_agents ADD COLUMN owner_id TEXT");
  }
  if (!memberColumns.some((column) => column.name === "agent_name_snapshot")) {
    sqlite.exec("ALTER TABLE conversation_agents ADD COLUMN agent_name_snapshot TEXT");
  }
  if (!memberColumns.some((column) => column.name === "owner_name_snapshot")) {
    sqlite.exec("ALTER TABLE conversation_agents ADD COLUMN owner_name_snapshot TEXT");
  }
  if (!memberColumns.some((column) => column.name === "hub_id_snapshot")) {
    sqlite.exec("ALTER TABLE conversation_agents ADD COLUMN hub_id_snapshot TEXT");
  }
  if (!memberColumns.some((column) => column.name === "joined_at")) {
    sqlite.exec("ALTER TABLE conversation_agents ADD COLUMN joined_at INTEGER NOT NULL DEFAULT 0");
  }
}

function initializeMessageSearch(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
    USING fts5(content, content='messages', content_rowid='rowid');

    CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content)
      VALUES ('delete', old.rowid, old.content);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF content ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content)
      VALUES ('delete', old.rowid, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);
  sqlite.prepare("INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')").run();
}

export type DatabaseContext = ReturnType<typeof createDatabase>;
