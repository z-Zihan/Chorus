import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseContext } from "./index.js";

describe("Relay database startup migrations", () => {
  let directory: string | undefined;
  let database: DatabaseContext | undefined;

  afterEach(() => {
    database?.sqlite.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
    database = undefined;
    directory = undefined;
  });

  it("adds Room invitations to an existing database without losing data", () => {
    directory = mkdtempSync(join(tmpdir(), "chorus-relay-migration-"));
    const dbPath = join(directory, "relay.db");
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE hubs (
        hub_id TEXT PRIMARY KEY,
        public_key TEXT NOT NULL,
        display_name TEXT NOT NULL,
        online INTEGER NOT NULL DEFAULT 0 CHECK (online IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE room_members (
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        hub_id TEXT NOT NULL REFERENCES hubs(hub_id) ON DELETE CASCADE,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (room_id, hub_id)
      );
      INSERT INTO hubs VALUES
        ('hub-a', 'key-a', 'Hub A', 0, 1, 1),
        ('hub-b', 'key-b', 'Hub B', 0, 1, 1);
      INSERT INTO rooms VALUES ('room-a', 'Existing Room', 'hub-a', 1);
      INSERT INTO room_members VALUES ('room-a', 'hub-a', 1);
    `);
    legacy.close();

    database = createDatabase(dbPath);
    const room = database.sqlite.prepare("SELECT name FROM rooms WHERE id = ?").get("room-a");
    expect(room).toEqual({ name: "Existing Room" });

    database.sqlite
      .prepare(
        `
      INSERT INTO room_invitations (
        room_id, invitee_hub_id, invited_by_hub_id, status, created_at, expires_at
      ) VALUES (?, ?, ?, 'pending', ?, ?)
    `,
      )
      .run("room-a", "hub-b", "hub-a", 2, 3);
    expect(
      database.sqlite
        .prepare(
          `
      SELECT status FROM room_invitations WHERE room_id = ? AND invitee_hub_id = ?
    `,
        )
        .get("room-a", "hub-b"),
    ).toEqual({ status: "pending" });
  });
});
