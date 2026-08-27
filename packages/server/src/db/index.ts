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
  ensureRoomStateColumns(sqlite);
  ensureRoomStateEventStorage(sqlite);
  ensureUserColumns(sqlite);
  ensureUserHubsTable(sqlite);
  ensureAgentDiscoveryColumns(sqlite);
  ensureAgentVisibilityColumn(sqlite);
  ensureTrustedHubsTable(sqlite);
  ensureClientTokensTable(sqlite);
  ensureProcessedEnvelopesTable(sqlite);
  ensureScheduledTaskRunColumns(sqlite);
  initializeMessageSearch(sqlite);
  return { sqlite, db };
}

function ensureScheduledTaskRunColumns(sqlite: Database.Database): void {
  const columns = sqlite.prepare("PRAGMA table_info(scheduled_tasks)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "last_run_at")) {
    sqlite.exec("ALTER TABLE scheduled_tasks ADD COLUMN last_run_at INTEGER");
  }
  if (!columns.some((column) => column.name === "last_result")) {
    sqlite.exec("ALTER TABLE scheduled_tasks ADD COLUMN last_result TEXT");
  }
  if (!columns.some((column) => column.name === "next_run_at")) {
    sqlite.exec("ALTER TABLE scheduled_tasks ADD COLUMN next_run_at INTEGER");
  }
}

function ensureAgentVisibilityColumn(sqlite: Database.Database): void {
  const columns = sqlite.prepare("PRAGMA table_info(agents)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "visibility")) {
    sqlite.exec("ALTER TABLE agents ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'");
  }
}

export function ensureRoomStateColumns(sqlite: Database.Database): void {
  const columns = sqlite.prepare("PRAGMA table_info(conversations)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "revision")) {
    sqlite.exec("ALTER TABLE conversations ADD COLUMN revision INTEGER NOT NULL DEFAULT 1");
  }
  if (!columns.some((column) => column.name === "key_epoch")) {
    sqlite.exec("ALTER TABLE conversations ADD COLUMN key_epoch INTEGER NOT NULL DEFAULT 1");
  }
  if (!columns.some((column) => column.name === "management_state")) {
    sqlite.exec(
      "ALTER TABLE conversations ADD COLUMN management_state TEXT NOT NULL DEFAULT 'managed'",
    );
  }
}

function ensureRoomStateEventStorage(sqlite: Database.Database): void {
  const memberColumns = sqlite.prepare("PRAGMA table_info(conversation_agents)").all() as Array<{
    name: string;
  }>;
  if (!memberColumns.some((column) => column.name === "owner_proof")) {
    sqlite.exec("ALTER TABLE conversation_agents ADD COLUMN owner_proof TEXT");
  }
  sqlite.exec(`CREATE TABLE IF NOT EXISTS room_state_events (
    event_id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    key_epoch INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    actor_signature TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    data TEXT NOT NULL
  )`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_room_state_events_room_revision
    ON room_state_events(room_id, revision)`);
}

export function ensureClientTokensTable(sqlite: Database.Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS client_tokens (
    id TEXT PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL,
    user_id TEXT,
    scopes TEXT NOT NULL DEFAULT '[]',
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked INTEGER NOT NULL DEFAULT 0
  )`);
}

export function ensureProcessedEnvelopesTable(sqlite: Database.Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS processed_envelopes (
    id TEXT PRIMARY KEY,
    processed_at INTEGER NOT NULL
  )`);
}

export function ensureUserHubsTable(sqlite: Database.Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS user_hubs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    hub_id TEXT NOT NULL,
    hub_display_name TEXT,
    bound INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_seen_at INTEGER
  )`);

  sqlite
    .prepare(
      `INSERT INTO user_hubs (
      id, user_id, hub_id, hub_display_name, bound, created_at, updated_at, last_seen_at
    )
    SELECT 'legacy:' || id || ':' || hub_id, id, hub_id, NULL, 1, created_at, updated_at, last_seen_at
    FROM users
    WHERE hub_id IS NOT NULL AND hub_id != ''
      AND NOT EXISTS (
        SELECT 1 FROM user_hubs
        WHERE user_hubs.user_id = users.id AND user_hubs.hub_id = users.hub_id
      )`,
    )
    .run();
}

function ensureAgentDiscoveryColumns(sqlite: Database.Database): void {
  const columns = sqlite.prepare("PRAGMA table_info(agents)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "capabilities")) {
    sqlite.exec("ALTER TABLE agents ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]'");
  }
  if (!columns.some((column) => column.name === "stale")) {
    sqlite.exec("ALTER TABLE agents ADD COLUMN stale INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.some((column) => column.name === "home_hub_id")) {
    sqlite.exec("ALTER TABLE agents ADD COLUMN home_hub_id TEXT");
  }
  sqlite.exec(`UPDATE agents
    SET home_hub_id = (SELECT hub_id FROM users WHERE users.id = agents.owner_id)
    WHERE owner_type = 'remote' AND home_hub_id IS NULL`);
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
