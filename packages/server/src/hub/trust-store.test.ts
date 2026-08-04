import { createHash, createPublicKey } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseContext } from "../db/index.js";
import { Repository } from "../db/repository.js";
import { computeSAS, TrustStore } from "./trust-store.js";

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

    const challenge = store.generatePairingCode("hub-a");

    expect(challenge.code).toMatch(/^\d{6}$/);
    expect(Buffer.from(challenge.nonce, "base64url")).toHaveLength(16);
    expect(createPublicKey({
      key: Buffer.from(challenge.ephemeralPublicKey, "base64"),
      format: "der",
      type: "spki",
    }).asymmetricKeyType).toBe("x25519");
    expect(store.get("hub-a")).toEqual({
      hubId: "hub-a",
      hubFingerprint: createHash("sha256").update("hub-a").digest("hex").slice(0, 32),
      trustLevel: "pending",
    });
    const wrongCode = challenge.code === "000000" ? "000001" : "000000";
    expect(store.confirmPairing(
      "hub-a",
      wrongCode,
      challenge.nonce,
      challenge.ephemeralPublicKey,
    )).toBe(false);
    expect(confirmChallenge(store, "hub-a", challenge)).toBe(true);
    expect(confirmChallenge(store, "hub-a", challenge)).toBe(false);
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
    const challenge = store.generatePairingCode("hub-expiring");

    vi.setSystemTime(1_000 + 10 * 60 * 1000 + 1);

    expect(confirmChallenge(store, "hub-expiring", challenge)).toBe(false);
    expect(store.get("hub-expiring")?.trustLevel).toBe("pending");
  });

  it("moves through pending, trusted, and blocked states", () => {
    const store = new TrustStore();
    store.addPending("hub-state");
    expect(store.get("hub-state")?.trustLevel).toBe("pending");

    const challenge = store.generatePairingCode("hub-state");
    expect(confirmChallenge(store, "hub-state", challenge)).toBe(true);
    expect(store.listTrusted()).toHaveLength(1);

    store.block("hub-state");
    expect(store.get("hub-state")?.trustLevel).toBe("blocked");
    expect(store.listTrusted()).toEqual([]);

    store.remove("hub-state");
    expect(store.get("hub-state")).toBeUndefined();
  });

  it("requires re-pairing when the pinned User public key changes", () => {
    const store = new TrustStore();
    const challenge = store.generatePairingCode("hub-key");
    confirmChallenge(store, "hub-key", challenge);
    store.recordSeen("hub-key", { userPublicKey: "user-key-a" });

    expect(store.detectKeyChange("hub-key", "user-key-a")).toBe(false);
    expect(store.detectKeyChange("hub-key", "user-key-b")).toBe(true);
    expect(store.get("hub-key")?.trustLevel).toBe("pending");
  });

  it("binds confirmation to the nonce and ephemeral public key", () => {
    const store = new TrustStore(undefined, "hub-local");
    const challenge = store.generatePairingCode("hub-peer");

    expect(store.confirmPairing(
      "hub-peer",
      challenge.code,
      `${challenge.nonce}x`,
      challenge.ephemeralPublicKey,
    )).toBe(false);
    expect(store.confirmPairing(
      "hub-peer",
      challenge.code,
      challenge.nonce,
      "not-a-public-key",
    )).toBe(false);
    expect(confirmChallenge(store, "hub-peer", challenge)).toBe(true);
  });

  it("computes an order-independent six-digit SAS", () => {
    const sas = computeSAS("hub-b", "hub-a", "nonce");

    expect(sas).toMatch(/^\d{6}$/);
    expect(sas).toBe(computeSAS("hub-a", "hub-b", "nonce"));
    expect(sas).not.toBe(computeSAS("hub-a", "hub-b", "other-nonce"));
  });
});

function confirmChallenge(
  store: TrustStore,
  hubId: string,
  challenge: ReturnType<TrustStore["generatePairingCode"]>,
): boolean {
  return store.confirmPairing(
    hubId,
    challenge.code,
    challenge.nonce,
    challenge.ephemeralPublicKey,
  );
}
