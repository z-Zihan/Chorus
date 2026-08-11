import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubEnvelope } from "@chorus/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseContext } from "./db/index.js";
import { OfflineStore } from "./offline-store.js";

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
});
