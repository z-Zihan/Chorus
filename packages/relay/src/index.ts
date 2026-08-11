import { resolve } from "node:path";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
import { createDatabase } from "./db/index.js";
import { HubRegistry } from "./hub-registry.js";
import { MessageRouter } from "./message-router.js";
import { OfflineStore } from "./offline-store.js";
import { registerRoutes } from "./routes/index.js";
import { RoomManager } from "./room-manager.js";
import { RoomCasStore } from "./room-cas.js";
import { logger } from "./utils/logger.js";
import { registerWebSocket } from "./ws/handler.js";

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<void> {
  const port = positiveInteger(process.env.RELAY_PORT, 3211);
  const jwtSecret = process.env.RELAY_JWT_SECRET?.trim() || "chorus-relay-development-secret";
  const ttlDays = positiveInteger(process.env.RELAY_OFFLINE_TTL_DAYS, 7);
  const retentionMs = positiveInteger(
    process.env.RELAY_OFFLINE_RETENTION_MS,
    ttlDays * 24 * 60 * 60 * 1_000,
  );
  const maxMessageSize = positiveInteger(process.env.RELAY_MAX_MESSAGE_SIZE, 256 * 1_024);
  const maxMessagesPerHub = positiveInteger(process.env.RELAY_MAX_MESSAGES_PER_HUB, 1_000);
  const maxMessagesPerMinute = positiveInteger(process.env.RELAY_MAX_MESSAGES_PER_MINUTE, 60);
  const maxRoomsPerHub = positiveInteger(process.env.RELAY_MAX_ROOMS_PER_HUB, 50);
  const maxMembersPerRoom = positiveInteger(process.env.RELAY_MAX_MEMBERS_PER_ROOM, 100);
  const maxHubs = positiveInteger(process.env.RELAY_MAX_HUBS, 1_000);
  const dbPath = resolve(process.env.RELAY_DB_PATH?.trim() || "./data/relay.db");

  if (!process.env.RELAY_JWT_SECRET) {
    logger.warn("RELAY_JWT_SECRET is unset; using the development-only default");
  }

  const database = createDatabase(dbPath);
  const registry = new HubRegistry(database);
  const offlineStore = new OfflineStore(
    database,
    retentionMs,
    maxMessageSize,
    maxMessagesPerHub,
  );
  const roomManager = new RoomManager(database, maxRoomsPerHub, maxMembersPerRoom);
  const roomCasStore = new RoomCasStore();
  const messageRouter = new MessageRouter(roomManager);
  const app = Fastify({ loggerInstance: logger as FastifyBaseLogger });

  await app.register(cors, { origin: true });
  await app.register(websocket);
  registerRoutes(app, { registry, roomManager, jwtSecret, maxHubs });
  registerWebSocket(app, {
    registry,
    offlineStore,
    roomManager,
    roomCasStore,
    messageRouter,
    jwtSecret,
    maxMessagesPerMinute,
  });

  offlineStore.cleanupExpired();
  const cleanupTimer = setInterval(() => {
    const removed = offlineStore.cleanupExpired();
    if (removed > 0) app.log.info({ removed }, "Expired offline messages removed");
  }, 60 * 60 * 1_000);
  cleanupTimer.unref();

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    clearInterval(cleanupTimer);
    await app.close();
    database.sqlite.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());

  await app.listen({ host: "0.0.0.0", port });
  app.log.info({ port, dbPath }, "Chorus relay server started");
}

main().catch((error) => {
  logger.fatal({ err: error }, "Relay startup failed");
  process.exit(1);
});
