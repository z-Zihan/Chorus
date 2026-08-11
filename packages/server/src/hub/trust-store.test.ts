import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseContext } from "../db/index.js";
import { Repository } from "../db/repository.js";
import { TrustStore } from "./trust-store.js";

const databases: DatabaseContext[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.sqlite.close();
});

describe("TrustStore", () => {
  it("persists a contact only through completed pairing identity data", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const store = new TrustStore(repository);
    store.addPending("hub-a");
    expect(store.get("hub-a")).toEqual({
      hubId: "hub-a",
      hubFingerprint: createHash("sha256").update("hub-a").digest("hex").slice(0, 32),
      trustLevel: "pending",
    });

    store.completePairing("hub-a", {
      userId: "usr_alice",
      userName: "Alice",
      userPublicKey: "a".repeat(64),
    });
    expect(new TrustStore(repository).get("hub-a")).toMatchObject({
      trustLevel: "trusted",
      userId: "usr_alice",
      userName: "Alice",
      userPublicKey: "a".repeat(64),
    });
  });

  it("moves through pending, trusted, blocked, and removed states", () => {
    const store = new TrustStore();
    store.addPending("hub-state");
    expect(store.get("hub-state")?.trustLevel).toBe("pending");
    store.completePairing("hub-state", {
      userId: "usr_state",
      userName: "State",
      userPublicKey: "b".repeat(64),
    });
    expect(store.isTrusted("hub-state")).toBe(true);
    store.block("hub-state");
    expect(store.get("hub-state")?.trustLevel).toBe("blocked");
    store.remove("hub-state");
    expect(store.get("hub-state")).toBeUndefined();
  });

  it("requires re-pairing when the pinned User public key changes", () => {
    const store = new TrustStore();
    store.completePairing("hub-key", {
      userId: "usr_key",
      userName: "Key",
      userPublicKey: "c".repeat(64),
    });
    expect(store.detectKeyChange("hub-key", "d".repeat(64))).toBe(true);
    expect(store.get("hub-key")?.trustLevel).toBe("pending");
  });
});
