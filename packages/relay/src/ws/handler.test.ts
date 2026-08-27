import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalize, type RelayServerMessage } from "@chorus/shared";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHubToken } from "../auth.js";
import { createDatabase, type DatabaseContext } from "../db/index.js";
import { HubRegistry } from "../hub-registry.js";
import { MessageRouter } from "../message-router.js";
import { OfflineStore } from "../offline-store.js";
import { RoomCasStore } from "../room-cas.js";
import { RoomManager } from "../room-manager.js";
import { registerWebSocket } from "./handler.js";

const JWT_SECRET = "relay-websocket-test-secret";

interface TestIdentity {
  hubId: string;
  privateKey: KeyObject;
}

function createIdentity(): TestIdentity {
  const keyPair = generateKeyPairSync("ed25519");
  const jwk = keyPair.publicKey.export({ format: "jwk" });
  if (!jwk.x) throw new Error("Missing Ed25519 public key");
  return {
    hubId: Buffer.from(jwk.x, "base64url").toString("hex"),
    privateKey: keyPair.privateKey,
  };
}

describe("Relay transport receipt protocol", () => {
  let directory: string;
  let database: DatabaseContext;
  let registry: HubRegistry;
  let offlineStore: OfflineStore;
  let app: ReturnType<typeof Fastify>;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "chorus-relay-ws-"));
    database = createDatabase(join(directory, "relay.db"));
    registry = new HubRegistry(database);
    offlineStore = new OfflineStore(database);
    const roomManager = new RoomManager(database);
    app = Fastify({ logger: false });
    await app.register(websocket);
    registerWebSocket(app, {
      registry,
      offlineStore,
      roomManager,
      roomCasStore: new RoomCasStore(database),
      messageRouter: new MessageRouter(roomManager),
      jwtSecret: JWT_SECRET,
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    registry.shutdown();
    for (const socket of sockets) socket.close();
    await app.close();
    database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("retains ciphertext until the recipient returns a valid signed receipt", async () => {
    const sender = createIdentity();
    const recipient = createIdentity();
    registry.register(sender.hubId, sender.hubId, "Sender");
    registry.register(recipient.hubId, recipient.hubId, "Recipient");
    const senderSocket = await connect(sender.hubId);
    const recipientSocket = await connect(recipient.hubId);
    const envelope = {
      id: "envelope-1",
      from: sender.hubId,
      to: recipient.hubId,
      type: "direct" as const,
      timestamp: 1_000,
      nonce: "nonce",
      ciphertext: "ciphertext",
      signature: "signature",
    };

    senderSocket.socket.send(JSON.stringify({ type: "message", envelope }));
    await recipientSocket.next((message) => message.type === "message");
    await senderSocket.next(
      (message) => message.type === "transport_status" && message.status === "queued",
    );
    expect(offlineStore.getForHub(recipient.hubId)).toHaveLength(1);

    const unsigned = {
      messageId: envelope.id,
      recipientHubId: recipient.hubId,
      status: "persisted" as const,
      timestamp: 2_000,
    };
    recipientSocket.socket.send(
      JSON.stringify({
        type: "transport_receipt",
        ...unsigned,
        signature: sign(
          null,
          Buffer.from(canonicalize(unsigned), "utf8"),
          recipient.privateKey,
        ).toString("base64"),
      }),
    );

    await senderSocket.next(
      (message) => message.type === "transport_status" && message.status === "delivered",
    );
    expect(offlineStore.getForHub(recipient.hubId)).toEqual([]);
  });

  it("rejects malformed registration frames without crashing the relay", async () => {
    const hub = createIdentity();
    registry.register(hub.hubId, hub.hubId, "Hub");
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Missing Relay test address");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    sockets.push(socket);
    await new Promise<void>((resolve) => socket.once("open", () => resolve()));
    // Valid hubId but token omitted: must be rejected, never throw past the listener.
    socket.send(JSON.stringify({ type: "register", hubId: hub.hubId }));
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
    // The relay process survives and still serves a well-formed registration.
    const recovered = await connect(hub.hubId);
    expect(recovered.socket.readyState).toBe(WebSocket.OPEN);
  });

  async function connect(hubId: string): Promise<{
    socket: WebSocket;
    next: (predicate: (message: RelayServerMessage) => boolean) => Promise<RelayServerMessage>;
  }> {
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Missing Relay test address");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    sockets.push(socket);
    const messages: RelayServerMessage[] = [];
    const waiters = new Set<{
      predicate: (message: RelayServerMessage) => boolean;
      resolve: (message: RelayServerMessage) => void;
    }>();
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as RelayServerMessage;
      for (const waiter of waiters) {
        if (!waiter.predicate(message)) continue;
        waiters.delete(waiter);
        waiter.resolve(message);
        return;
      }
      messages.push(message);
    });
    const next = (predicate: (message: RelayServerMessage) => boolean) => {
      const index = messages.findIndex(predicate);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0] as RelayServerMessage);
      return new Promise<RelayServerMessage>((resolve, reject) => {
        const waiter = { predicate, resolve };
        waiters.add(waiter);
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error("Timed out waiting for Relay test message"));
        }, 2_000);
        timer.unref();
        waiter.resolve = (message) => {
          clearTimeout(timer);
          resolve(message);
        };
      });
    };
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => {
        socket.send(
          JSON.stringify({
            type: "register",
            hubId,
            token: createHubToken(hubId, JWT_SECRET),
          }),
        );
        resolve();
      });
      socket.once("error", reject);
    });
    await next((message) => message.type === "registered");
    return { socket, next };
  }
});
