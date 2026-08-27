import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hubs, rooms } from "./db/schema.js";
import { createDatabase, type DatabaseContext } from "./db/index.js";
import { RoomCasStore } from "./room-cas.js";

describe("RoomCasStore", () => {
  let directory: string;
  let database: DatabaseContext;
  let store: RoomCasStore;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "chorus-relay-cas-"));
    database = createDatabase(join(directory, "relay.db"));
    database.db
      .insert(hubs)
      .values({
        hubId: "hub-a",
        publicKey: "k",
        displayName: "A",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .onConflictDoNothing()
      .run();
    database.db
      .insert(rooms)
      .values({ id: "room-1", name: "R", createdBy: "hub-a", createdAt: Date.now() })
      .onConflictDoNothing()
      .run();
    store = new RoomCasStore(database);
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("accepts a matching first proposal and returns the authoritative state on mismatch", () => {
    expect(store.cas("room-1", 1, 1, 2, 1)).toEqual({
      accepted: true,
      revision: 2,
      keyEpoch: 1,
    });
    const rejected = store.cas("room-1", 1, 1, 2, 1);
    expect(rejected.accepted).toBe(false);
    expect(rejected.revision).toBe(2);
  });

  it("allows a flat key epoch for membership bumps but rejects epoch jumps beyond +1", () => {
    expect(store.cas("room-1", 1, 1, 2, 1).accepted).toBe(true);
    expect(store.cas("room-1", 2, 1, 3, 3).accepted).toBe(false);
    expect(store.cas("room-1", 2, 1, 3, 2).accepted).toBe(true);
  });

  it("keeps counters in the database, not in memory (fresh instance sees them)", () => {
    expect(store.cas("room-1", 1, 1, 2, 1).accepted).toBe(true);
    // A brand-new store over the same database (what a relay restart does) must
    // observe the persisted counters, not reset to {1,1}.
    const reopened = new RoomCasStore(createDatabase(join(directory, "relay.db")));
    expect(reopened.get("room-1")).toEqual({ revision: 2, keyEpoch: 1 });
    expect(reopened.cas("room-1", 1, 1, 2, 2).accepted).toBe(false);
    expect(reopened.cas("room-1", 2, 1, 3, 1).accepted).toBe(true);
  });

  it("seeds unknown rooms at {1,1}: a matching first proposal initializes the counters", () => {
    expect(store.get("missing")).toEqual({ revision: 1, keyEpoch: 1 });
    expect(store.cas("missing", 1, 1, 2, 1)).toEqual({ accepted: true, revision: 2, keyEpoch: 1 });
    expect(store.get("missing")).toEqual({ revision: 2, keyEpoch: 1 });
  });
});
