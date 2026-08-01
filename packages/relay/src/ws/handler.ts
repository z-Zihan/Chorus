import type { HubEnvelope, RelayClientMessage, RelayServerMessage } from "@agentlink/shared";
import type { FastifyInstance } from "fastify";
import { verifyHubToken } from "../auth.js";
import type { HubRegistry } from "../hub-registry.js";
import type { MessageRouter } from "../message-router.js";
import type { OfflineStore } from "../offline-store.js";
import type { RoomManager } from "../room-manager.js";
import type { RelaySocket } from "../socket.js";
import { sendJson } from "../socket.js";

interface WebSocketDependencies {
  registry: HubRegistry;
  offlineStore: OfflineStore;
  roomManager: RoomManager;
  messageRouter: MessageRouter;
  jwtSecret: string;
}

function parseMessage(data: { toString(): string }): RelayClientMessage | null {
  try {
    const value = JSON.parse(data.toString()) as unknown;
    if (typeof value !== "object" || value === null || !("type" in value) || typeof value.type !== "string") {
      return null;
    }
    return value as RelayClientMessage;
  } catch {
    return null;
  }
}

function broadcastPresence(registry: HubRegistry, hubId: string, status: "online" | "offline"): void {
  const message: RelayServerMessage = { type: "presence", hubId, status };
  for (const hub of registry.listOnline()) sendJson(hub.socket, message);
}

function broadcastRoomEvent(
  registry: HubRegistry,
  roomManager: RoomManager,
  roomId: string,
  event: "join" | "leave" | "invite",
  hubId: string,
): void {
  const message: RelayServerMessage = { type: "room:event", roomId, event, hubId };
  for (const member of roomManager.getMembers(roomId)) {
    const socket = registry.getSocket(member.hubId);
    if (socket) sendJson(socket, message);
  }
}

function validEnvelope(value: unknown): value is HubEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const envelope = value as Partial<HubEnvelope>;
  return typeof envelope.id === "string"
    && typeof envelope.from === "string"
    && typeof envelope.to === "string"
    && typeof envelope.type === "string"
    && typeof envelope.timestamp === "number"
    && typeof envelope.nonce === "string"
    && typeof envelope.ciphertext === "string"
    && typeof envelope.signature === "string";
}

export function registerWebSocket(app: FastifyInstance, dependencies: WebSocketDependencies): void {
  const { registry, offlineStore, roomManager, messageRouter, jwtSecret } = dependencies;

  app.get("/ws", { websocket: true }, (rawSocket) => {
    const socket = rawSocket as unknown as RelaySocket;
    let hubId: string | null = null;
    let alive = true;

    const registrationTimeout = setTimeout(() => {
      if (!hubId) socket.close(1008, "Registration required");
    }, 10_000);

    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, 30_000);

    socket.on("pong", () => {
      alive = true;
    });

    socket.on("message", (data) => {
      const message = parseMessage(data);
      if (!message) {
        socket.close(1003, "Invalid message");
        return;
      }

      if (!hubId) {
        if (message.type !== "register"
          || !registry.get(message.hubId)
          || !verifyHubToken(message.token, message.hubId, jwtSecret)) {
          socket.close(1008, "Invalid registration");
          return;
        }
        const previous = registry.getSocket(message.hubId);
        if (previous && previous !== socket) previous.close(1000, "Connection replaced");
        hubId = message.hubId;
        clearTimeout(registrationTimeout);
        registry.setOnline(hubId, socket);
        sendJson(socket, { type: "registered", relayHubId: hubId } satisfies RelayServerMessage);
        sendJson(socket, {
          type: "offline_messages",
          envelopes: offlineStore.getForHub(hubId),
        } satisfies RelayServerMessage);
        broadcastPresence(registry, hubId, "online");
        return;
      }

      try {
        if (message.type === "message") {
          if (!validEnvelope(message.envelope) || message.envelope.from !== hubId) {
            socket.close(1008, "Envelope sender does not match registered hub");
            return;
          }
          messageRouter.routeMessage(message.envelope, registry, offlineStore);
        } else if (message.type === "room:join" && typeof message.roomId === "string") {
          roomManager.joinRoom(message.roomId, hubId);
          broadcastRoomEvent(registry, roomManager, message.roomId, "join", hubId);
          sendJson(socket, {
            type: "room:members",
            roomId: message.roomId,
            members: roomManager.getMembers(message.roomId),
          } satisfies RelayServerMessage);
        } else if (message.type === "room:leave" && typeof message.roomId === "string") {
          roomManager.leaveRoom(message.roomId, hubId);
          broadcastRoomEvent(registry, roomManager, message.roomId, "leave", hubId);
        } else if (message.type === "ping") {
          sendJson(socket, { type: "pong" } satisfies RelayServerMessage);
        }
      } catch (error) {
        app.log.warn({ err: error, hubId }, "Unable to handle relay WebSocket message");
      }
    });

    const disconnect = () => {
      clearTimeout(registrationTimeout);
      clearInterval(heartbeat);
      if (hubId && registry.getSocket(hubId) === socket) {
        registry.setOffline(hubId);
        broadcastPresence(registry, hubId, "offline");
      }
    };

    socket.on("close", disconnect);
    socket.on("error", (error) => {
      app.log.warn({ err: error, hubId }, "Relay WebSocket error");
      disconnect();
    });
  });
}
