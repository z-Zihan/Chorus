import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseContext } from "../db/index.js";
import { Repository } from "../db/repository.js";
import { TrustStore } from "./trust-store.js";

const databases: DatabaseContext[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const database of databases.splice(0)) database.sqlite.close();
});

describe("TrustStore", () => {
  it("generates a six-digit one-time pairing code and persists trust", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const store = new TrustStore(repository);

    const code = store.generatePairingCode("hub-a");

    expect(code).toMatch(/^\d{6}$/);
    expect(store.get("hub-a")).toEqual({
      hubId: "hub-a",
      hubFingerprint: createHash("sha256").update("hub-a").digest("hex").slice(0, 32),
      trustLevel: "pending",
    });
    expect(store.confirmPairing("hub-a", "000000" === code ? "000001" : "000000")).toBe(false);
    expect(store.confirmPairing("hub-a", code)).toBe(true);
    expect(store.confirmPairing("hub-a", code)).toBe(false);
    expect(store.isTrusted("hub-a")).toBe(true);
    expect(new TrustStore(repository).get("hub-a")).toMatchObject({
      hubId: "hub-a",
      trustLevel: "trusted",
    });
  });

  it("expires pairing codes after ten minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const store = new TrustStore();
    const code = store.generatePairingCode("hub-expiring");

    vi.setSystemTime(1_000 + 10 * 60 * 1000 + 1);

    expect(store.confirmPairing("hub-expiring", code)).toBe(false);
    expect(store.get("hub-expiring")?.trustLevel).toBe("pending");
  });

  it("moves through pending, trusted, and blocked states", () => {
    const store = new TrustStore();
    store.addPending("hub-state");
    expect(store.get("hub-state")?.trustLevel).toBe("pending");

    const code = store.generatePairingCode("hub-state");
    expect(store.confirmPairing("hub-state", code)).toBe(true);
    expect(store.listTrusted()).toHaveLength(1);

    store.block("hub-state");
    expect(store.get("hub-state")?.trustLevel).toBe("blocked");
    expect(store.listTrusted()).toEqual([]);

    store.remove("hub-state");
    expect(store.get("hub-state")).toBeUndefined();
  });

  it("requires re-pairing when the pinned User public key changes", () => {
    const store = new TrustStore();
    const code = store.generatePairingCode("hub-key");
    store.confirmPairing("hub-key", code);
    store.recordSeen("hub-key", { userPublicKey: "user-key-a" });

    expect(store.detectKeyChange("hub-key", "user-key-a")).toBe(false);
    expect(store.detectKeyChange("hub-key", "user-key-b")).toBe(true);
    expect(store.get("hub-key")?.trustLevel).toBe("pending");
  });
});
