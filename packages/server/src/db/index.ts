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
  return { sqlite, db };
}

export type DatabaseContext = ReturnType<typeof createDatabase>;
