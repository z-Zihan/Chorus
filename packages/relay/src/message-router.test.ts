import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HubEnvelope, RelayServerMessage } from "@chorus/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseContext } from "./db/index.js";
import { HubRegistry } from "./hub-registry.js";
import { MessageRouter } from "./message-router.js";
import { OfflineStore } from "./offline-store.js";
import { RoomManager } from "./room-manager.js";
import { OPEN_SOCKET_STATE, type RelaySocket } from "./socket.js";

interface FakeSocket extends RelaySocket {
  sent: RelayServerMessage[];
}

function createSocket(readyState = OPEN_SOCKET_STATE): FakeSocket {
  const sent: RelayServerMessage[] = [];
  const socket: FakeSocket = {
    readyState,
    sent,
    send: (data: string) => {
      sent.push(JSON.parse(data) as RelayServerMessage);
    },
    ping: () => {},
    close: () => {},
    terminate: () => {},
    on: () => socket,
  };
  return socket;
}

function envelope(overrides: Partial<HubEnvelope> = {}): HubEnvelope {
  return {
    id: "envelope-1",
    from: "hub-a",
    to: "hub-b",
    type: "direct",
    timestamp: 1_000,
    nonce: "nonce",
    ciphertext: "ciphertext",
    signature: "signature",
    ...overrides,
  };
}

describe("MessageRouter", () => {
  let directory: string;
  let database: DatabaseContext;
  let registry: HubRegistry;
  let offlineStore: OfflineStore;
  let rooms: RoomManager;
  let router: MessageRouter;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "chorus-relay-router-"));
    database = createDatabase(join(directory, "relay.db"));
    registry = new HubRegistry(database);
    offlineStore = new OfflineStore(database);
    rooms = new RoomManager(database);
    router = new MessageRouter(rooms);
    for (const hubId of ["hub-a", "hub-b", "hub-c", "hub-d"]) {
      registry.register(hubId, `key-${hubId}`, hubId);
    }
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function route(message: HubEnvelope) {
    return router.routeMessage(message, registry, offlineStore);
  }

  describe("direct messages", () => {
    it("delivers to an online recipient and still stores the envelope", () => {
      const socket = createSocket();
      registry.setOnline("hub-b", socket);
      const message = envelope();

      expect(route(message)).toBe("delivered");

      expect(socket.sent).toHaveLength(1);
      const [payload] = socket.sent;
      expect(payload).toMatchObject({ type: "message", envelope: message });
      const forwarded = payload?.type === "message" ? payload.envelope : undefined;
      expect(forwarded?.relayTimestamp).toBeGreaterThan(message.timestamp);
      expect(offlineStore.getEnvelope(message.id, "hub-b")).toMatchObject({
        ...message,
        relayTimestamp: forwarded?.relayTimestamp,
      });
    });

    it("queues for a registered recipient that was never online", () => {
      const message = envelope();

      expect(route(message)).toBe("queued");
      expect(offlineStore.getForHub("hub-b")).toEqual([
        expect.objectContaining({ id: message.id }),
      ]);
    });

    it("queues for a recipient that went offline", () => {
      const socket = createSocket();
      registry.setOnline("hub-b", socket);
      registry.setOffline("hub-b");

      expect(route(envelope())).toBe("queued");
      expect(socket.sent).toEqual([]);
      expect(offlineStore.getForHub("hub-b")).toHaveLength(1);
    });

    it("queues when the recipient socket is not open", () => {
      const socket = createSocket(3);
      registry.setOnline("hub-b", socket);

      expect(route(envelope())).toBe("queued");
      expect(socket.sent).toEqual([]);
      expect(offlineStore.getForHub("hub-b")).toHaveLength(1);
    });

    it("blocks in both directions without storing", () => {
      const socketA = createSocket();
      const socketB = createSocket();
      registry.setOnline("hub-a", socketA);
      registry.setOnline("hub-b", socketB);
      registry.blockHub("hub-a", "hub-b");

      // The block check runs before the offline store for direct messages.
      expect(route(envelope({ id: "a-to-b" }))).toBe("blocked");
      expect(route(envelope({ id: "b-to-a", from: "hub-b", to: "hub-a" }))).toBe("blocked");

      expect(socketA.sent).toEqual([]);
      expect(socketB.sent).toEqual([]);
      expect(offlineStore.hasMessage("a-to-b")).toBe(false);
      expect(offlineStore.hasMessage("b-to-a")).toBe(false);
    });
  });

  describe("broadcast", () => {
    it("is blocked and nothing is stored", () => {
      const socket = createSocket();
      registry.setOnline("hub-b", socket);

      expect(route(envelope({ to: "broadcast" }))).toBe("blocked");
      expect(socket.sent).toEqual([]);
      expect(offlineStore.hasMessage("envelope-1")).toBe(false);
    });
  });

  describe("room messages", () => {
    function createRoom(members: string[]): string {
      const room = rooms.createRoom("Room", "hub-a");
      for (const hubId of members) rooms.joinRoom(room.id, hubId);
      return room.id;
    }

    it("rejects a missing room", () => {
      expect(() => route(envelope({ to: "room:room-missing", type: "group" }))).toThrow(
        "Room not found",
      );
    });

    it("rejects senders that are not members", () => {
      const roomId = createRoom(["hub-b"]);

      expect(() => route(envelope({ from: "hub-c", to: `room:${roomId}`, type: "group" }))).toThrow(
        "Room membership required to send messages",
      );
      expect(offlineStore.hasMessage("envelope-1")).toBe(false);
    });

    it("fans out to every member except the sender", () => {
      const roomId = createRoom(["hub-b", "hub-c"]);
      const sockets = { a: createSocket(), b: createSocket(), c: createSocket() };
      registry.setOnline("hub-a", sockets.a);
      registry.setOnline("hub-b", sockets.b);
      registry.setOnline("hub-c", sockets.c);
      const message = envelope({ to: `room:${roomId}`, type: "group" });

      expect(route(message)).toBe("delivered");

      expect(sockets.a.sent).toEqual([]);
      expect(sockets.b.sent).toEqual([
        { type: "message", envelope: { ...message, relayTimestamp: expect.any(Number) } },
      ]);
      expect(sockets.c.sent).toHaveLength(1);
      expect(offlineStore.getEnvelope(message.id, "hub-a")).toBeUndefined();
      expect(offlineStore.getEnvelope(message.id, "hub-b")).toBeDefined();
      expect(offlineStore.getEnvelope(message.id, "hub-c")).toBeDefined();
    });

    it("skips blocked members while delivering to the rest", () => {
      const roomId = createRoom(["hub-b", "hub-c"]);
      const socketB = createSocket();
      const socketC = createSocket();
      registry.setOnline("hub-b", socketB);
      registry.setOnline("hub-c", socketC);
      registry.blockHub("hub-b", "hub-a");

      expect(route(envelope({ to: `room:${roomId}`, type: "group" }))).toBe("delivered");

      expect(socketB.sent).toEqual([]);
      expect(socketC.sent).toHaveLength(1);
      expect(offlineStore.getEnvelope("envelope-1", "hub-b")).toBeUndefined();
      expect(offlineStore.getEnvelope("envelope-1", "hub-c")).toBeDefined();
    });

    it("stores for offline members while delivering to online ones", () => {
      const roomId = createRoom(["hub-b", "hub-c"]);
      const socketB = createSocket();
      registry.setOnline("hub-b", socketB);

      expect(route(envelope({ to: `room:${roomId}`, type: "group" }))).toBe("delivered");

      expect(socketB.sent).toHaveLength(1);
      expect(offlineStore.getForHub("hub-c")).toEqual([
        expect.objectContaining({ id: "envelope-1" }),
      ]);
    });

    it("queues when every recipient is offline", () => {
      const roomId = createRoom(["hub-b", "hub-c"]);
      registry.setOnline("hub-c", createSocket(3));

      expect(route(envelope({ to: `room:${roomId}`, type: "group" }))).toBe("queued");
      expect(offlineStore.getForHub("hub-b")).toHaveLength(1);
      expect(offlineStore.getForHub("hub-c")).toHaveLength(1);
    });

    it("is blocked when every recipient is blocked", () => {
      const roomId = createRoom(["hub-b", "hub-c"]);
      const socketB = createSocket();
      registry.setOnline("hub-b", socketB);
      registry.blockHub("hub-a", "hub-b");
      registry.blockHub("hub-c", "hub-a");

      expect(route(envelope({ to: `room:${roomId}`, type: "group" }))).toBe("blocked");
      expect(socketB.sent).toEqual([]);
      expect(offlineStore.hasMessage("envelope-1")).toBe(false);
    });

    it("is blocked when the sender is the only member", () => {
      const roomId = createRoom([]);
      const socketA = createSocket();
      registry.setOnline("hub-a", socketA);

      // No recipients means neither delivered nor queued.
      expect(route(envelope({ to: `room:${roomId}`, type: "group" }))).toBe("blocked");
      expect(socketA.sent).toEqual([]);
    });
  });
});
