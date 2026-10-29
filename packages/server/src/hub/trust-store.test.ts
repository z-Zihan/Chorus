import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseContext } from "../db/index.js";
import { Repository } from "../db/repository.js";
import { TrustStore } from "./trust-store.js";

const databases: DatabaseContext[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.sqlite.close();
  vi.useRealTimers();
});

const identity = {
  userId: "usr_edge",
  userName: "Edge",
  userPublicKey: "e".repeat(64),
};

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
  it("does not overwrite an existing contact when addPending is called again", () => {
    const store = new TrustStore();
    store.completePairing("hub-keep", identity);
    store.addPending("hub-keep");
    expect(store.get("hub-keep")).toMatchObject({ ...identity, trustLevel: "trusted" });
  });

  it.each(["", "   "])("rejects blank hubId %j in mutating methods", (hubId) => {
    const store = new TrustStore();
    expect(() => store.addPending(hubId)).toThrow("hubId must be a non-empty string");
    expect(() => store.completePairing(hubId, identity)).toThrow(
      "hubId must be a non-empty string",
    );
    expect(() => store.block(hubId)).toThrow("hubId must be a non-empty string");
  });

  it("trims the hubId before storing a pending contact", () => {
    const store = new TrustStore();
    store.addPending("  hub-x  ");
    expect(store.get("hub-x")).toMatchObject({ hubId: "hub-x", trustLevel: "pending" });
    expect(store.get("  hub-x  ")).toBeUndefined();
  });

  it("reports no key change for unknown hubs, unpinned hubs, or matching keys", () => {
    const store = new TrustStore();
    expect(store.detectKeyChange("hub-unknown", "f".repeat(64))).toBe(false);

    store.addPending("hub-unpinned");
    expect(store.detectKeyChange("hub-unpinned", "f".repeat(64))).toBe(false);
    expect(store.get("hub-unpinned")?.trustLevel).toBe("pending");

    store.completePairing("hub-same", identity);
    expect(store.detectKeyChange("hub-same", identity.userPublicKey)).toBe(false);
    expect(store.get("hub-same")?.trustLevel).toBe("trusted");
  });

  it("returns defensive copies from get", () => {
    const store = new TrustStore();
    store.completePairing("hub-copy", identity);
    const copy = store.get("hub-copy");
    if (!copy) throw new Error("expected hub-copy");
    copy.trustLevel = "blocked";
    copy.userName = "Mallory";
    expect(store.get("hub-copy")).toMatchObject({ trustLevel: "trusted", userName: "Edge" });
  });

  it("ignores recordSeen for unknown hubs", () => {
    const store = new TrustStore();
    expect(() => store.recordSeen("hub-ghost", { userName: "Ghost" })).not.toThrow();
    expect(store.get("hub-ghost")).toBeUndefined();
  });

  it("updates lastSeenAt and merges identity fields in recordSeen", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const store = new TrustStore();
    store.completePairing("hub-seen", identity);
    expect(store.get("hub-seen")?.lastSeenAt).toBe(1_000);

    vi.setSystemTime(5_000);
    store.recordSeen("hub-seen", { userName: "Edge Renamed" });
    expect(store.get("hub-seen")).toEqual({
      hubId: "hub-seen",
      hubFingerprint: expect.any(String),
      ...identity,
      userName: "Edge Renamed",
      trustLevel: "trusted",
      pairedAt: 1_000,
      lastSeenAt: 5_000,
    });
  });

  it("fingerprints hex hub ids by raw bytes and other ids by UTF-8 bytes", () => {
    const store = new TrustStore();
    const hexId = "a".repeat(64);
    store.addPending(hexId);
    store.addPending("hub-a");
    expect(store.get(hexId)?.hubFingerprint).toBe(
      createHash("sha256").update(Buffer.from(hexId, "hex")).digest("hex").slice(0, 32),
    );
    expect(store.get("hub-a")?.hubFingerprint).toBe(
      createHash("sha256").update(Buffer.from("hub-a", "utf8")).digest("hex").slice(0, 32),
    );
  });

  it("establishes trust directly for a hub that was never pending", () => {
    vi.useFakeTimers();
    vi.setSystemTime(42_000);
    const store = new TrustStore();
    const result = store.completePairing("hub-fresh", identity);
    expect(result).toMatchObject({
      hubId: "hub-fresh",
      ...identity,
      trustLevel: "trusted",
      pairedAt: 42_000,
    });
    expect(store.isTrusted("hub-fresh")).toBe(true);
  });
});
