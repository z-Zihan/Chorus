import type {
  HubEnvelope,
  RelayClientMessage,
  RelayServerMessage,
  TransportStatusUpdate,
} from "@chorus/shared";
import type { FastifyInstance } from "fastify";
import { verifyHubToken, verifyTransportReceipt } from "../auth.js";
import type { HubRegistry } from "../hub-registry.js";
import type { MessageRouter } from "../message-router.js";
import type { OfflineStore } from "../offline-store.js";
import type { RoomCasStore } from "../room-cas.js";
import type { RoomManager } from "../room-manager.js";
import type { RelaySocket } from "../socket.js";
import { sendJson } from "../socket.js";

interface WebSocketDependencies {
  registry: HubRegistry;
  offlineStore: OfflineStore;
  roomManager: RoomManager;
  roomCasStore: RoomCasStore;
  messageRouter: MessageRouter;
  jwtSecret: string;
  maxMessagesPerMinute?: number;
}

const DEFAULT_MAX_MESSAGES_PER_MINUTE = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

interface RateWindow {
  startedAt: number;
  count: number;
}

function parseMessage(data: { toString(): string }): RelayClientMessage | null {
  try {
    const value = JSON.parse(data.toString()) as unknown;
    if (
      typeof value !== "object" ||
      value === null ||
      !("type" in value) ||
      typeof value.type !== "string"
    ) {
      return null;
    }
    return value as RelayClientMessage;
  } catch {
    return null;
  }
}

function presenceMessage(
  registry: HubRegistry,
  hubId: string,
  status: "online" | "offline",
): RelayServerMessage {
  const hub = registry.get(hubId);
  return {
    type: "presence",
    hubId,
    status,
    publicKey: hub?.publicKey,
    displayName: hub?.displayName,
  };
}

function broadcastPresence(
  registry: HubRegistry,
  hubId: string,
  status: "online" | "offline",
): void {
  const message = presenceMessage(registry, hubId, status);
  for (const hub of registry.listOnline()) sendJson(hub.socket, message);
}

function sendPresenceSnapshot(registry: HubRegistry, socket: RelaySocket, ownHubId: string): void {
  for (const hub of registry.listOnline()) {
    if (hub.hubId === ownHubId) continue;
    sendJson(socket, presenceMessage(registry, hub.hubId, "online"));
  }
}

function notifyEnvelopeSender(
  registry: HubRegistry,
  envelope: HubEnvelope,
  status: TransportStatusUpdate["status"],
  fallbackSocket?: RelaySocket,
): void {
  const socket = fallbackSocket ?? registry.getSocket(envelope.from);
  if (!socket) return;
  sendJson(socket, {
    type: "transport_status",
    messageId: envelope.id,
    status,
    timestamp: Date.now(),
  } satisfies RelayServerMessage);
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
  return (
    typeof envelope.id === "string" &&
    typeof envelope.from === "string" &&
    typeof envelope.to === "string" &&
    typeof envelope.type === "string" &&
    typeof envelope.timestamp === "number" &&
    typeof envelope.nonce === "string" &&
    typeof envelope.ciphertext === "string" &&
    typeof envelope.signature === "string"
  );
}

export function registerWebSocket(app: FastifyInstance, dependencies: WebSocketDependencies): void {
  const { registry, offlineStore, roomManager, roomCasStore, messageRouter, jwtSecret } =
    dependencies;
  const maxMessagesPerMinute = dependencies.maxMessagesPerMinute ?? DEFAULT_MAX_MESSAGES_PER_MINUTE;
  const rateWindows = new Map<string, RateWindow>();

  const exceedsRateLimit = (hubId: string): boolean => {
    const now = Date.now();
    const current = rateWindows.get(hubId);
    if (!current || now - current.startedAt >= RATE_LIMIT_WINDOW_MS) {
      rateWindows.set(hubId, { startedAt: now, count: 1 });
      return false;
    }
    current.count += 1;
    return current.count > maxMessagesPerMinute;
  };

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
        if (
          message.type !== "register" ||
          !registry.get(message.hubId) ||
          !verifyHubToken(
            message.token,
            message.hubId,
            jwtSecret,
            undefined,
            registry.get(message.hubId)?.authVersion,
          )
        ) {
          socket.close(1008, "Invalid registration");
          return;
        }
        const previous = registry.getSocket(message.hubId);
        if (previous && previous !== socket) previous.close(1000, "Connection replaced");
        hubId = message.hubId;
        const registeredHubId = hubId;
        clearTimeout(registrationTimeout);
        registry.setOnline(registeredHubId, socket);
        sendJson(socket, {
          type: "registered",
          relayHubId: registeredHubId,
        } satisfies RelayServerMessage);
        sendPresenceSnapshot(registry, socket, registeredHubId);
        const envelopes = offlineStore
          .getForHub(registeredHubId)
          .filter((envelope) => !registry.isBlocked(envelope.from, registeredHubId));
        sendJson(socket, {
          type: "offline_messages",
          envelopes,
        } satisfies RelayServerMessage);
        broadcastPresence(registry, registeredHubId, "online");
        return;
      }

      try {
        if (message.type === "message") {
          if (!validEnvelope(message.envelope) || message.envelope.from !== hubId) {
            socket.close(1008, "Envelope sender does not match registered hub");
            return;
          }
          const messageSize = JSON.stringify(message.envelope).length;
          if (messageSize > offlineStore.maxMessageSize) {
            app.log.warn(
              { hubId, messageSize, maxMessageSize: offlineStore.maxMessageSize },
              "Relay message size limit exceeded",
            );
            socket.close(1009, "Message too large");
            return;
          }
          if (exceedsRateLimit(hubId)) {
            app.log.warn({ hubId, maxMessagesPerMinute }, "Relay message rate limit exceeded");
            socket.close(1008, "Message rate limit exceeded");
            return;
          }
          const result = messageRouter.routeMessage(message.envelope, registry, offlineStore);
          if (result === "blocked") {
            notifyEnvelopeSender(registry, message.envelope, "failed", socket);
          } else {
            notifyEnvelopeSender(registry, message.envelope, "queued", socket);
          }
        } else if (message.type === "transport_receipt") {
          const receipt = {
            messageId: message.messageId,
            recipientHubId: message.recipientHubId,
            status: message.status,
            timestamp: message.timestamp,
            signature: message.signature,
          };
          const registered = registry.get(hubId);
          if (
            receipt.recipientHubId !== hubId ||
            receipt.status !== "persisted" ||
            !registered ||
            !verifyTransportReceipt(receipt, registered.publicKey)
          ) {
            socket.close(1008, "Invalid transport receipt");
            return;
          }
          const envelope = offlineStore.getEnvelope(receipt.messageId, hubId);
          if (!envelope) return;
          offlineStore.ackMessage(receipt.messageId, hubId);
          if (!offlineStore.hasMessage(receipt.messageId)) {
            notifyEnvelopeSender(registry, envelope, "delivered");
          }
        } else if (message.type === "contact_block") {
          const blockedHubId =
            typeof message.blockedHubId === "string" ? message.blockedHubId.trim() : "";
          const success =
            blockedHubId.length > 0 &&
            blockedHubId !== hubId &&
            registry.get(blockedHubId) !== null;
          if (success) registry.blockHub(hubId, blockedHubId);
          sendJson(socket, {
            type: "contact_block_ack",
            blockedHubId,
            success,
          } satisfies RelayServerMessage);
        } else if (message.type === "room:join" && typeof message.roomId === "string") {
          const wasAlreadyMember = roomManager.isMember(message.roomId, hubId);
          if (!wasAlreadyMember) {
            roomManager.respondToInvitation(message.roomId, hubId, "accepted");
            broadcastRoomEvent(registry, roomManager, message.roomId, "join", hubId);
          }
          sendJson(socket, {
            type: "room:members",
            roomId: message.roomId,
            members: roomManager.getMembers(message.roomId),
          } satisfies RelayServerMessage);
        } else if (message.type === "room:leave" && typeof message.roomId === "string") {
          roomManager.leaveRoom(message.roomId, hubId);
          broadcastRoomEvent(registry, roomManager, message.roomId, "leave", hubId);
        } else if (message.type === "room_cas") {
          if (!validRoomCasMessage(message) || !roomManager.isMember(message.roomId, hubId)) {
            socket.close(1008, "Invalid or unauthorized Room CAS");
            return;
          }
          const result = roomCasStore.cas(
            message.roomId,
            message.expectedRevision,
            message.expectedKeyEpoch,
            message.newRevision,
            message.newKeyEpoch,
          );
          sendJson(socket, {
            type: "room_cas_result",
            roomId: message.roomId,
            ...result,
          } satisfies RelayServerMessage);
        } else if (message.type === "ping") {
          sendJson(socket, { type: "pong" } satisfies RelayServerMessage);
        }
      } catch (error) {
        app.log.warn({ err: error, hubId }, "Unable to handle relay WebSocket message");
        if (message.type === "message" && validEnvelope(message.envelope)) {
          notifyEnvelopeSender(registry, message.envelope, "failed", socket);
        }
      }
    });

    const disconnect = () => {
      clearTimeout(registrationTimeout);
      clearInterval(heartbeat);
      if (hubId && registry.getSocket(hubId) === socket) {
        registry.setOffline(hubId);
        registry.unblockHub(hubId);
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

function validRoomCasMessage(message: Extract<RelayClientMessage, { type: "room_cas" }>): boolean {
  return (
    message.roomId.length > 0 &&
    Number.isSafeInteger(message.expectedRevision) &&
    message.expectedRevision >= 0 &&
    Number.isSafeInteger(message.expectedKeyEpoch) &&
    message.expectedKeyEpoch >= 0 &&
    Number.isSafeInteger(message.newRevision) &&
    message.newRevision >= 0 &&
    Number.isSafeInteger(message.newKeyEpoch) &&
    message.newKeyEpoch >= 0
  );
}
