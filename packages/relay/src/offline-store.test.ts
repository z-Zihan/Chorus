import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubEnvelope } from "@chorus/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseContext } from "./db/index.js";
import { offlineMessages } from "./db/schema.js";
import { DEFAULT_MAX_MESSAGE_SIZE, DEFAULT_RETENTION_MS, OfflineStore } from "./offline-store.js";

describe("Relay durable envelope receipts", () => {
  let directory: string;
  let database: DatabaseContext;
  let store: OfflineStore;

  const envelope: HubEnvelope = {
    id: "envelope-1",
    from: "hub-a",
    to: "room:room-1",
    type: "group",
    timestamp: 1_000,
    nonce: "nonce",
    ciphertext: "ciphertext",
    signature: "signature",
  };

  const insertRawRow = (row: {
    id: string;
    toHubId: string;
    envelope: string;
    createdAt: number;
    expiresAt: number;
  }) => {
    database.db.insert(offlineMessages).values(row).run();
  };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "chorus-relay-offline-"));
    database = createDatabase(join(directory, "relay.db"));
    store = new OfflineStore(database);
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("stores idempotently per recipient and acknowledges only that recipient", () => {
    store.store(envelope, "hub-b");
    store.store(envelope, "hub-b");
    store.store(envelope, "hub-c");

    expect(store.getForHub("hub-b")).toHaveLength(1);
    expect(store.getForHub("hub-c")).toHaveLength(1);
    expect(store.getEnvelope(envelope.id, "hub-b")).toMatchObject({ id: envelope.id });

    expect(store.ackMessage(envelope.id, "hub-b")).toBe(1);
    expect(store.getForHub("hub-b")).toEqual([]);
    expect(store.hasMessage(envelope.id)).toBe(true);
    expect(store.ackMessage(envelope.id, "hub-c")).toBe(1);
    expect(store.hasMessage(envelope.id)).toBe(false);
  });

  it("rejects envelopes that exceed maxMessageSize and does not persist them", () => {
    const limitedStore = new OfflineStore(database, DEFAULT_RETENTION_MS, 64);

    expect(() => limitedStore.store(envelope, "hub-big")).toThrowError(/bytes/);
    expect(limitedStore.getForHub("hub-big")).toEqual([]);
  });

  it("trims the oldest messages once a hub exceeds maxMessagesPerHub, independently per hub", () => {
    const cappedStore = new OfflineStore(
      database,
      DEFAULT_RETENTION_MS,
      DEFAULT_MAX_MESSAGE_SIZE,
      3,
    );

    vi.useFakeTimers();
    try {
      vi.setSystemTime(500);
      cappedStore.store({ ...envelope, id: "other-hub-env" }, "hub-other");

      vi.setSystemTime(1_000);
      cappedStore.store({ ...envelope, id: "e1" }, "hub-cap");
      vi.setSystemTime(1_001);
      cappedStore.store({ ...envelope, id: "e2" }, "hub-cap");
      vi.setSystemTime(1_002);
      cappedStore.store({ ...envelope, id: "e3" }, "hub-cap");
      vi.setSystemTime(1_003);
      cappedStore.store({ ...envelope, id: "e4" }, "hub-cap");

      expect(cappedStore.getForHub("hub-cap").map((e) => e.id)).toEqual(["e2", "e3", "e4"]);
      expect(cappedStore.getForHub("hub-other").map((e) => e.id)).toEqual(["other-hub-env"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("excludes expired messages from getForHub while keeping unexpired ones", () => {
    const expiredStore = new OfflineStore(database, -1_000);
    expiredStore.store({ ...envelope, id: "expired-env" }, "hub-exp");
    store.store({ ...envelope, id: "fresh-env" }, "hub-exp");

    expect(store.getForHub("hub-exp").map((e) => e.id)).toEqual(["fresh-env"]);
  });

  it("returns getForHub results ordered by createdAt ascending regardless of insertion order", () => {
    const future = Date.now() + 1_000_000;

    insertRawRow({
      id: "row-c",
      toHubId: "hub-order",
      envelope: JSON.stringify({ ...envelope, id: "env-c" }),
      createdAt: 300,
      expiresAt: future,
    });
    insertRawRow({
      id: "row-a",
      toHubId: "hub-order",
      envelope: JSON.stringify({ ...envelope, id: "env-a" }),
      createdAt: 100,
      expiresAt: future,
    });
    insertRawRow({
      id: "row-b",
      toHubId: "hub-order",
      envelope: JSON.stringify({ ...envelope, id: "env-b" }),
      createdAt: 200,
      expiresAt: future,
    });

    expect(store.getForHub("hub-order").map((e) => e.id)).toEqual(["env-a", "env-b", "env-c"]);
  });

  it("skips rows with corrupted envelope JSON in getForHub without throwing", () => {
    store.store(envelope, "hub-mixed");
    insertRawRow({
      id: "corrupt-row",
      toHubId: "hub-mixed",
      envelope: "{not valid json",
      createdAt: Date.now() + 1,
      expiresAt: Date.now() + 1_000_000,
    });

    expect(() => store.getForHub("hub-mixed")).not.toThrow();
    expect(store.getForHub("hub-mixed").map((e) => e.id)).toEqual([envelope.id]);
  });

  describe("getEnvelope", () => {
    it("returns the parsed envelope on a hit", () => {
      store.store(envelope, "hub-e");
      expect(store.getEnvelope(envelope.id, "hub-e")).toEqual(envelope);
    });

    it("returns undefined when the message id does not exist", () => {
      expect(store.getEnvelope("missing-id", "hub-e")).toBeUndefined();
    });

    it("returns undefined when the toHubId does not match", () => {
      store.store(envelope, "hub-e");
      expect(store.getEnvelope(envelope.id, "hub-other")).toBeUndefined();
    });

    // Deviation from the original task spec: getEnvelope's WHERE clause filters by
    // json_extract(envelope, '$.id') directly in SQL, so a row with malformed envelope
    // JSON under a matching toHubId makes SQLite raise "malformed JSON" before the
    // try/catch around JSON.parse ever runs. It throws rather than returning undefined.
    it("throws when a matching-toHubId row has malformed envelope JSON", () => {
      insertRawRow({
        id: "corrupt-row",
        toHubId: "hub-corrupt",
        envelope: "not-json",
        createdAt: Date.now(),
        expiresAt: Date.now() + 1_000_000,
      });

      expect(() => store.getEnvelope("anything", "hub-corrupt")).toThrow(/malformed JSON/i);
    });
  });

  describe("ackMessage boundaries", () => {
    it("returns 0 and deletes nothing when messageId is empty", () => {
      store.store(envelope, "hub-ack");
      expect(store.ackMessage("", "hub-ack")).toBe(0);
      expect(store.getForHub("hub-ack")).toHaveLength(1);
    });

    it("returns 0 and deletes nothing when toHubId is empty", () => {
      store.store(envelope, "hub-ack");
      expect(store.ackMessage(envelope.id, "")).toBe(0);
      expect(store.getForHub("hub-ack")).toHaveLength(1);
    });

    it("returns 0 and leaves the row intact when toHubId does not match", () => {
      store.store(envelope, "hub-ack");
      expect(store.ackMessage(envelope.id, "hub-other")).toBe(0);
      expect(store.getForHub("hub-ack")).toHaveLength(1);
    });

    it("returns 1 and deletes the row on a matching ack", () => {
      store.store(envelope, "hub-ack");
      expect(store.ackMessage(envelope.id, "hub-ack")).toBe(1);
      expect(store.getForHub("hub-ack")).toHaveLength(0);
    });
  });

  describe("hasMessage", () => {
    it("returns true when any recipient still holds the message", () => {
      store.store(envelope, "hub-h1");
      expect(store.hasMessage(envelope.id)).toBe(true);
    });

    it("returns false when no recipient holds the message", () => {
      expect(store.hasMessage("nonexistent")).toBe(false);
    });
  });

  describe("cleanupExpired", () => {
    it("removes expired rows and trims any hub still over capacity, counting both", () => {
      const cleanupStore = new OfflineStore(
        database,
        DEFAULT_RETENTION_MS,
        DEFAULT_MAX_MESSAGE_SIZE,
        3,
      );
      const past = Date.now() - 1_000;
      const future = Date.now() + 1_000_000;

      insertRawRow({
        id: "exp-1",
        toHubId: "hub-a",
        envelope: JSON.stringify({ ...envelope, id: "env-exp-1" }),
        createdAt: 1,
        expiresAt: past,
      });
      insertRawRow({
        id: "exp-2",
        toHubId: "hub-a",
        envelope: JSON.stringify({ ...envelope, id: "env-exp-2" }),
        createdAt: 2,
        expiresAt: past,
      });

      insertRawRow({
        id: "fresh-1",
        toHubId: "hub-b",
        envelope: JSON.stringify({ ...envelope, id: "env-fresh-1" }),
        createdAt: 1,
        expiresAt: future,
      });
      insertRawRow({
        id: "fresh-2",
        toHubId: "hub-b",
        envelope: JSON.stringify({ ...envelope, id: "env-fresh-2" }),
        createdAt: 2,
        expiresAt: future,
      });
      insertRawRow({
        id: "fresh-3",
        toHubId: "hub-b",
        envelope: JSON.stringify({ ...envelope, id: "env-fresh-3" }),
        createdAt: 3,
        expiresAt: future,
      });
      insertRawRow({
        id: "fresh-4",
        toHubId: "hub-b",
        envelope: JSON.stringify({ ...envelope, id: "env-fresh-4" }),
        createdAt: 4,
        expiresAt: future,
      });
      insertRawRow({
        id: "fresh-5",
        toHubId: "hub-b",
        envelope: JSON.stringify({ ...envelope, id: "env-fresh-5" }),
        createdAt: 5,
        expiresAt: future,
      });

      expect(cleanupStore.cleanupExpired()).toBe(4);
      expect(cleanupStore.getForHub("hub-a")).toEqual([]);
      expect(cleanupStore.getForHub("hub-b").map((e) => e.id)).toEqual([
        "env-fresh-3",
        "env-fresh-4",
        "env-fresh-5",
      ]);
    });

    it("returns 0 when there is nothing to clean up", () => {
      expect(store.cleanupExpired()).toBe(0);
    });
  });

  it("expires messages according to a custom retentionMs and cleans them up", async () => {
    const shortLivedStore = new OfflineStore(database, 50);
    shortLivedStore.store({ ...envelope, id: "short-lived" }, "hub-ttl");

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(shortLivedStore.cleanupExpired()).toBe(1);
    expect(shortLivedStore.getForHub("hub-ttl")).toEqual([]);
  });
});
