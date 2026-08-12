import { resolve } from "node:path";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
import { createDatabase } from "./db/index.js";
import { RegistrationChallengeStore } from "./auth.js";
import { HubRegistry } from "./hub-registry.js";
import { MessageRouter } from "./message-router.js";
import { OfflineStore } from "./offline-store.js";
import { registerRoutes } from "./routes/index.js";
import { RoomManager } from "./room-manager.js";
import { RoomCasStore } from "./room-cas.js";
import { logger } from "./utils/logger.js";
import { registerWebSocket } from "./ws/handler.js";
import { resolveRelaySecurityConfig } from "./config.js";

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<void> {
  const port = positiveInteger(process.env.RELAY_PORT, 3211);
  const { host, jwtSecret } = resolveRelaySecurityConfig();
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
  const tokenTtlSeconds = positiveInteger(process.env.RELAY_TOKEN_TTL_SECONDS, 24 * 60 * 60);
  const maxChallengesPerMinute = positiveInteger(process.env.RELAY_MAX_CHALLENGES_PER_MINUTE, 10);
  const maxRegistrationsPerMinute = positiveInteger(
    process.env.RELAY_MAX_REGISTRATIONS_PER_MINUTE,
    30,
  );
  const dbPath = resolve(process.env.RELAY_DB_PATH?.trim() || "./data/relay.db");
  const corsOrigins = (process.env.RELAY_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!process.env.RELAY_JWT_SECRET && (host === "127.0.0.1" || host === "localhost")) {
    logger.warn("RELAY_JWT_SECRET is unset; using the development-only default");
  }

  const database = createDatabase(dbPath);
  const registry = new HubRegistry(database);
  const offlineStore = new OfflineStore(database, retentionMs, maxMessageSize, maxMessagesPerHub);
  const roomManager = new RoomManager(database, maxRoomsPerHub, maxMembersPerRoom);
  const roomCasStore = new RoomCasStore();
  const messageRouter = new MessageRouter(roomManager);
  const registrationChallenges = new RegistrationChallengeStore();
  const app = Fastify({ loggerInstance: logger as FastifyBaseLogger });

  await app.register(cors, { origin: corsOrigins.length > 0 ? corsOrigins : false });
  await app.register(websocket);
  registerRoutes(app, {
    registry,
    roomManager,
    jwtSecret,
    maxHubs,
    registrationChallenges,
    tokenTtlSeconds,
    maxChallengesPerMinute,
    maxRegistrationsPerMinute,
  });
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
  const cleanupTimer = setInterval(
    () => {
      const removed = offlineStore.cleanupExpired();
      if (removed > 0) app.log.info({ removed }, "Expired offline messages removed");
    },
    60 * 60 * 1_000,
  );
  cleanupTimer.unref();
  const checkpointTimer = setInterval(
    () => {
      database.sqlite.pragma("wal_checkpoint(PASSIVE)");
    },
    5 * 60 * 1_000,
  );
  checkpointTimer.unref();

  let closing = false;
  const close = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, "Relay shutdown started");
    clearInterval(cleanupTimer);
    clearInterval(checkpointTimer);
    registry.shutdown();
    await app.close();
    database.sqlite.close();
    logger.info({ signal }, "Relay shutdown completed");
  };
  process.once("SIGINT", () => void close("SIGINT"));
  process.once("SIGTERM", () => void close("SIGTERM"));

  await app.listen({ host, port });
  app.log.info({ host, port, dbPath }, "Chorus relay server started");
}

main().catch((error) => {
  logger.fatal({ err: error }, "Relay startup failed");
  process.exit(1);
});
