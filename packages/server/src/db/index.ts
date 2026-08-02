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
  initializeMessageSearch(sqlite);
  return { sqlite, db };
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
