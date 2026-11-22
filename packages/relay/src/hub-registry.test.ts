import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseContext } from "./db/index.js";
import { HubRegistry } from "./hub-registry.js";
import type { RelaySocket } from "./socket.js";

function fakeSocket(): RelaySocket & { close: ReturnType<typeof vi.fn> } {
  return {
    readyState: 1,
    send: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn().mockReturnThis(),
  } as unknown as RelaySocket & { close: ReturnType<typeof vi.fn> };
}

describe("HubRegistry blocks", () => {
  let directory: string | undefined;
  let database: DatabaseContext | undefined;

  afterEach(() => {
    database?.sqlite.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
    database = undefined;
    directory = undefined;
  });

  it("keeps contact blocks across disconnects and Relay restarts", () => {
    directory = mkdtempSync(join(tmpdir(), "chorus-relay-block-"));
    const dbPath = join(directory, "relay.db");
    database = createDatabase(dbPath);
    const registry = new HubRegistry(database);
    registry.register("hub-a", "key-a", "Hub A");
    registry.register("hub-b", "key-b", "Hub B");
    registry.blockHub("hub-a", "hub-b");

    registry.setOffline("hub-a");
    expect(registry.isBlocked("hub-a", "hub-b")).toBe(true);

    database.sqlite.close();
    database = createDatabase(dbPath);
    const restarted = new HubRegistry(database);
    expect(restarted.isBlocked("hub-b", "hub-a")).toBe(true);
  });
});

describe("HubRegistry", () => {
  let directory: string | undefined;
  let database: DatabaseContext | undefined;

  function openRegistry(): { registry: HubRegistry; database: DatabaseContext; dbPath: string } {
    directory ??= mkdtempSync(join(tmpdir(), "chorus-relay-registry-"));
    const dbPath = join(directory, "relay.db");
    database = createDatabase(dbPath);
    return { registry: new HubRegistry(database), database, dbPath };
  }

  afterEach(() => {
    vi.useRealTimers();
    if (database?.sqlite.open) database.sqlite.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
    database = undefined;
    directory = undefined;
  });

  it("registers a new Hub offline at auth version 1", () => {
    vi.useFakeTimers({ now: 5_000, toFake: ["Date"] });
    const { registry } = openRegistry();

    expect(registry.get("hub-a")).toBeNull();
    expect(registry.register("hub-a", "key-a", "Hub A")).toEqual({
      hubId: "hub-a",
      publicKey: "key-a",
      displayName: "Hub A",
      online: false,
      authVersion: 1,
      createdAt: 5_000,
      updatedAt: 5_000,
    });
    expect(registry.get("hub-a")?.authVersion).toBe(1);
  });

  it("bumps the auth version and updates details on re-registration", () => {
    vi.useFakeTimers({ now: 5_000, toFake: ["Date"] });
    const { registry } = openRegistry();
    registry.register("hub-a", "key-a", "Hub A");

    vi.setSystemTime(6_000);
    expect(registry.register("hub-a", "key-a2", "Hub A Renamed")).toMatchObject({
      publicKey: "key-a2",
      displayName: "Hub A Renamed",
      authVersion: 2,
      createdAt: 5_000,
      updatedAt: 6_000,
    });
    expect(registry.register("hub-a", "key-a2", "Hub A Renamed").authVersion).toBe(3);
    expect(registry.list()).toHaveLength(1);
  });

  it("tracks sockets and online state through setOnline and setOffline", () => {
    const { registry } = openRegistry();
    registry.register("hub-a", "key-a", "Hub A");
    registry.register("hub-b", "key-b", "Hub B");
    const socket = fakeSocket();

    expect(registry.getSocket("hub-a")).toBeNull();
    registry.setOnline("hub-a", socket);
    expect(registry.getSocket("hub-a")).toBe(socket);
    expect(registry.get("hub-a")?.online).toBe(true);
    expect(registry.get("hub-b")?.online).toBe(false);
    expect(registry.listOnline()).toEqual([
      expect.objectContaining({ hubId: "hub-a", online: true, socket }),
    ]);

    registry.setOffline("hub-a");
    expect(registry.getSocket("hub-a")).toBeNull();
    expect(registry.get("hub-a")?.online).toBe(false);
    expect(registry.listOnline()).toEqual([]);
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("does not list a socket for a Hub that is not registered", () => {
    const { registry } = openRegistry();
    const socket = fakeSocket();

    registry.setOnline("ghost", socket);
    expect(registry.getSocket("ghost")).toBe(socket);
    expect(registry.get("ghost")).toBeNull();
    expect(registry.listOnline()).toEqual([]);
  });

  it("does not list a Hub marked online in storage without a live socket", () => {
    const { registry, database: db } = openRegistry();
    registry.register("hub-a", "key-a", "Hub A");
    db.sqlite.prepare("UPDATE hubs SET online = 1 WHERE hub_id = 'hub-a'").run();

    expect(registry.get("hub-a")?.online).toBe(true);
    expect(registry.listOnline()).toEqual([]);
  });

  it("marks every persisted Hub offline when a registry starts", () => {
    const { registry, dbPath } = openRegistry();
    registry.register("hub-a", "key-a", "Hub A");
    registry.setOnline("hub-a", fakeSocket());
    database?.sqlite.close();

    database = createDatabase(dbPath);
    const restarted = new HubRegistry(database);
    expect(restarted.get("hub-a")?.online).toBe(false);
    expect(restarted.getSocket("hub-a")).toBeNull();
  });

  it("closes every socket once on shutdown and stops persisting later disconnects", () => {
    const { registry, database: db } = openRegistry();
    registry.register("hub-a", "key-a", "Hub A");
    registry.register("hub-b", "key-b", "Hub B");
    const socketA = fakeSocket();
    const socketB = fakeSocket();
    registry.setOnline("hub-a", socketA);
    registry.setOnline("hub-b", socketB);

    registry.shutdown();
    expect(socketA.close).toHaveBeenCalledWith(1001, "Relay shutting down");
    expect(socketB.close).toHaveBeenCalledWith(1001, "Relay shutting down");
    expect(registry.list().every((hub) => !hub.online)).toBe(true);
    expect(registry.getSocket("hub-a")).toBeNull();

    registry.shutdown();
    expect(socketA.close).toHaveBeenCalledTimes(1);

    // Socket close handlers fire after shutdown; they must not touch the closed database.
    db.sqlite.close();
    expect(() => registry.setOffline("hub-a")).not.toThrow();
  });

  it("treats blocks as symmetric and idempotent", () => {
    const { registry } = openRegistry();
    registry.register("hub-a", "key-a", "Hub A");
    registry.register("hub-b", "key-b", "Hub B");
    registry.register("hub-c", "key-c", "Hub C");

    expect(registry.isBlocked("hub-a", "hub-b")).toBe(false);
    registry.blockHub("hub-a", "hub-b");
    expect(() => registry.blockHub("hub-a", "hub-b")).not.toThrow();
    expect(registry.isBlocked("hub-a", "hub-b")).toBe(true);
    expect(registry.isBlocked("hub-b", "hub-a")).toBe(true);
    expect(registry.isBlocked("hub-a", "hub-c")).toBe(false);
    expect(registry.isBlocked("hub-c", "hub-b")).toBe(false);
  });

  it("clears blocks in both directions for an unblocked Hub only", () => {
    const { registry } = openRegistry();
    registry.register("hub-a", "key-a", "Hub A");
    registry.register("hub-b", "key-b", "Hub B");
    registry.register("hub-c", "key-c", "Hub C");
    registry.blockHub("hub-a", "hub-b");
    registry.blockHub("hub-c", "hub-a");
    registry.blockHub("hub-b", "hub-c");

    registry.unblockHub("hub-a");
    expect(registry.isBlocked("hub-a", "hub-b")).toBe(false);
    expect(registry.isBlocked("hub-c", "hub-a")).toBe(false);
    expect(registry.isBlocked("hub-b", "hub-c")).toBe(true);
  });

  it("unregisters a Hub, closing its socket and removing its blocks", () => {
    const { registry } = openRegistry();
    registry.register("hub-a", "key-a", "Hub A");
    registry.register("hub-b", "key-b", "Hub B");
    registry.register("hub-c", "key-c", "Hub C");
    registry.blockHub("hub-b", "hub-a");
    registry.blockHub("hub-b", "hub-c");
    const socket = fakeSocket();
    registry.setOnline("hub-a", socket);

    expect(registry.unregister("hub-a")).toBe(true);
    expect(socket.close).toHaveBeenCalledWith(1000, "Hub deregistered");
    expect(registry.get("hub-a")).toBeNull();
    expect(registry.getSocket("hub-a")).toBeNull();
    expect(registry.isBlocked("hub-b", "hub-a")).toBe(false);
    expect(registry.isBlocked("hub-b", "hub-c")).toBe(true);
    expect(registry.list().map((hub) => hub.hubId)).toEqual(["hub-b", "hub-c"]);
  });

  it("reports false when unregistering an unknown Hub", () => {
    const { registry } = openRegistry();
    expect(registry.unregister("missing")).toBe(false);
  });
});
