import type { FastifyInstance, FastifyReply } from "fastify";
import { createHubToken } from "../auth.js";
import type { HubRegistry } from "../hub-registry.js";
import type { RoomManager } from "../room-manager.js";

interface RouteDependencies {
  registry: HubRegistry;
  roomManager: RoomManager;
  jwtSecret: string;
  maxHubs: number;
}

function objectBody(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
}

function requiredString(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: message });
}

export function registerRoutes(app: FastifyInstance, dependencies: RouteDependencies): void {
  const { registry, roomManager, jwtSecret, maxHubs } = dependencies;

  app.post("/api/hubs/register", (request, reply) => {
    const body = objectBody(request.body);
    const hubId = requiredString(body, "hubId");
    const publicKey = requiredString(body, "publicKey");
    const displayName = requiredString(body, "displayName");
    if (!hubId || !publicKey || !displayName) {
      return badRequest(reply, "hubId, publicKey, and displayName are required");
    }
    if (!registry.get(hubId) && registry.list().length >= maxHubs) {
      return reply.code(503).send({ error: "Relay hub capacity reached" });
    }
    registry.register(hubId, publicKey, displayName);
    return reply.code(201).send({ token: createHubToken(hubId, jwtSecret), relayHubId: hubId });
  });

  app.get<{ Params: { id: string } }>("/api/hubs/:id", (request, reply) => {
    const hub = registry.get(request.params.id);
    return hub ? reply.send(hub) : reply.code(404).send({ error: "Hub not found" });
  });

  app.post("/api/hubs/discover", (request, reply) => {
    const body = objectBody(request.body);
    if (!Array.isArray(body.hubIds) || !body.hubIds.every((value) => typeof value === "string")) {
      return badRequest(reply, "hubIds must be an array of strings");
    }
    const discovered = body.hubIds.map((hubId) => {
      const hub = registry.get(hubId as string);
      return hub ? { ...hub, online: registry.getSocket(hub.hubId) !== null } : { hubId, online: false };
    });
    return reply.send({ hubs: discovered });
  });

  app.delete<{ Params: { id: string } }>("/api/hubs/:id", (request, reply) => {
    return registry.unregister(request.params.id)
      ? reply.code(204).send()
      : reply.code(404).send({ error: "Hub not found" });
  });

  app.post("/api/rooms", (request, reply) => {
    const body = objectBody(request.body);
    const name = requiredString(body, "name");
    const createdBy = requiredString(body, "createdBy") ?? requiredString(body, "hubId");
    if (!name || !createdBy) return badRequest(reply, "name and createdBy are required");
    try {
      const room = roomManager.createRoom(name, createdBy);
      return reply.code(201).send({ ...room, members: roomManager.getMembers(room.id) });
    } catch (error) {
      return badRequest(reply, error instanceof Error ? error.message : "Unable to create room");
    }
  });

  app.get<{ Params: { id: string } }>("/api/rooms/:id", (request, reply) => {
    const room = roomManager.getRoomInfo(request.params.id);
    return room ? reply.send(room) : reply.code(404).send({ error: "Room not found" });
  });

  app.post<{ Params: { id: string } }>("/api/rooms/:id/join", (request, reply) => {
    const hubId = requiredString(objectBody(request.body), "hubId");
    if (!hubId) return badRequest(reply, "hubId is required");
    try {
      roomManager.joinRoom(request.params.id, hubId);
      return reply.send({ members: roomManager.getMembers(request.params.id) });
    } catch (error) {
      return badRequest(reply, error instanceof Error ? error.message : "Unable to join room");
    }
  });

  app.post<{ Params: { id: string } }>("/api/rooms/:id/leave", (request, reply) => {
    const hubId = requiredString(objectBody(request.body), "hubId");
    if (!hubId) return badRequest(reply, "hubId is required");
    if (!roomManager.getRoom(request.params.id)) return reply.code(404).send({ error: "Room not found" });
    roomManager.leaveRoom(request.params.id, hubId);
    return reply.send({ members: roomManager.getMembers(request.params.id) });
  });

  app.post<{ Params: { id: string } }>("/api/rooms/:id/invite", (request, reply) => {
    const hubId = requiredString(objectBody(request.body), "hubId");
    if (!hubId) return badRequest(reply, "hubId is required");
    try {
      roomManager.inviteToRoom(request.params.id, hubId);
      return reply.send({ members: roomManager.getMembers(request.params.id) });
    } catch (error) {
      return badRequest(reply, error instanceof Error ? error.message : "Unable to invite hub");
    }
  });

  app.get("/api/health", (_request, reply) => {
    return reply.send({ ok: true, hubs: registry.list().length });
  });
}
