import type { RelayServerMessage } from "@chorus/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  authenticatedHubClaims,
  createHubToken,
  type RegistrationChallengeStore,
} from "../auth.js";
import type { HubRegistry } from "../hub-registry.js";
import type { RoomManager } from "../room-manager.js";
import { sendJson } from "../socket.js";

interface RouteDependencies {
  registry: HubRegistry;
  roomManager: RoomManager;
  jwtSecret: string;
  maxHubs: number;
  registrationChallenges: RegistrationChallengeStore;
  tokenTtlSeconds: number;
  maxChallengesPerMinute?: number;
  maxRegistrationsPerMinute?: number;
}

const RATE_WINDOW_MS = 60_000;

function rateLimiter(limit: number): (key: string) => boolean {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return (key: string) => {
    const now = Date.now();
    const current = windows.get(key);
    if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
      windows.set(key, { startedAt: now, count: 1 });
      if (windows.size > 10_000) {
        const oldest = windows.keys().next().value as string | undefined;
        if (oldest) windows.delete(oldest);
      }
      return false;
    }
    current.count += 1;
    return current.count > limit;
  };
}

function tooManyRequests(reply: FastifyReply) {
  return reply
    .header("Retry-After", "60")
    .code(429)
    .send({ error: "Too many registration attempts" });
}

function objectBody(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

function requiredString(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function badRequest(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: message });
}

function requireAuthenticatedHub(
  request: FastifyRequest,
  reply: FastifyReply,
  registry: HubRegistry,
  jwtSecret: string,
): string | undefined {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const claims = token ? authenticatedHubClaims(token, jwtSecret) : null;
  const hub = claims ? registry.get(claims.sub) : null;
  if (!claims || !hub || claims.ver !== hub.authVersion) {
    void reply.code(401).send({ error: "Valid Hub authentication is required" });
    return undefined;
  }
  return claims.sub;
}

export function registerRoutes(app: FastifyInstance, dependencies: RouteDependencies): void {
  const { registry, roomManager, jwtSecret, maxHubs, registrationChallenges, tokenTtlSeconds } =
    dependencies;
  const challengeLimited = rateLimiter(dependencies.maxChallengesPerMinute ?? 10);
  const registrationLimited = rateLimiter(dependencies.maxRegistrationsPerMinute ?? 30);

  app.post("/api/hubs/challenge", (request, reply) => {
    const body = objectBody(request.body);
    const hubId = requiredString(body, "hubId");
    const publicKey = requiredString(body, "publicKey");
    const displayName = requiredString(body, "displayName");
    if (!hubId || !publicKey || !displayName) {
      return badRequest(reply, "hubId, publicKey, and displayName are required");
    }
    if (challengeLimited(`ip:${request.ip}`) || challengeLimited(`hub:${hubId}`)) {
      return tooManyRequests(reply);
    }
    if (hubId !== publicKey || !/^[0-9a-f]{64}$/iu.test(publicKey)) {
      return badRequest(reply, "hubId must equal the 32-byte Ed25519 public key");
    }
    return reply.send(registrationChallenges.create(hubId, publicKey, displayName));
  });

  app.post("/api/hubs/register", (request, reply) => {
    if (registrationLimited(`ip:${request.ip}`)) return tooManyRequests(reply);
    const body = objectBody(request.body);
    const challengeId = requiredString(body, "challengeId");
    const signature = requiredString(body, "signature");
    if (!challengeId || !signature) {
      return badRequest(reply, "challengeId and signature are required");
    }
    const challenge = registrationChallenges.consume(challengeId, signature);
    if (!challenge) return reply.code(401).send({ error: "Invalid or expired registration proof" });
    const { hubId, publicKey, displayName } = challenge;
    if (!registry.get(hubId) && registry.list().length >= maxHubs) {
      return reply.code(503).send({ error: "Relay hub capacity reached" });
    }
    const hub = registry.register(hubId, publicKey, displayName);
    return reply.code(201).send({
      token: createHubToken(hubId, jwtSecret, tokenTtlSeconds, undefined, hub.authVersion),
      expiresInSeconds: tokenTtlSeconds,
      relayHubId: hubId,
    });
  });

  app.get<{ Params: { id: string } }>("/api/hubs/:id", (request, reply) => {
    if (!requireAuthenticatedHub(request, reply, registry, jwtSecret)) return;
    const hub = registry.get(request.params.id);
    return hub ? reply.send(hub) : reply.code(404).send({ error: "Hub not found" });
  });

  app.post("/api/hubs/discover", (request, reply) => {
    if (!requireAuthenticatedHub(request, reply, registry, jwtSecret)) return;
    const body = objectBody(request.body);
    if (!Array.isArray(body.hubIds) || !body.hubIds.every((value) => typeof value === "string")) {
      return badRequest(reply, "hubIds must be an array of strings");
    }
    const discovered = body.hubIds.map((hubId) => {
      const hub = registry.get(hubId as string);
      return hub
        ? { ...hub, online: registry.getSocket(hub.hubId) !== null }
        : { hubId, online: false };
    });
    return reply.send({ hubs: discovered });
  });

  app.delete<{ Params: { id: string } }>("/api/hubs/:id", (request, reply) => {
    const callerHubId = requireAuthenticatedHub(request, reply, registry, jwtSecret);
    if (!callerHubId) return;
    if (callerHubId !== request.params.id) {
      return reply.code(403).send({ error: "A Hub can only unregister itself" });
    }
    return registry.unregister(request.params.id)
      ? reply.code(204).send()
      : reply.code(404).send({ error: "Hub not found" });
  });

  app.post("/api/rooms", (request, reply) => {
    const callerHubId = requireAuthenticatedHub(request, reply, registry, jwtSecret);
    if (!callerHubId) return;
    const body = objectBody(request.body);
    const name = requiredString(body, "name");
    if (!name) return badRequest(reply, "name is required");
    try {
      const room = roomManager.createRoom(name, callerHubId);
      return reply.code(201).send({ ...room, members: roomManager.getMembers(room.id) });
    } catch (error) {
      return badRequest(reply, error instanceof Error ? error.message : "Unable to create room");
    }
  });

  app.get<{ Params: { id: string } }>("/api/rooms/:id", (request, reply) => {
    const callerHubId = requireAuthenticatedHub(request, reply, registry, jwtSecret);
    if (!callerHubId) return;
    if (!roomManager.isMember(request.params.id, callerHubId)) {
      return reply.code(403).send({ error: "Room membership required" });
    }
    const room = roomManager.getRoomInfo(request.params.id);
    return room ? reply.send(room) : reply.code(404).send({ error: "Room not found" });
  });

  app.post<{ Params: { id: string } }>("/api/rooms/:id/join", (request, reply) => {
    const callerHubId = requireAuthenticatedHub(request, reply, registry, jwtSecret);
    if (!callerHubId) return;
    try {
      const invitation = roomManager.respondToInvitation(
        request.params.id,
        callerHubId,
        "accepted",
      );
      return reply.send({
        invitation,
        room: roomManager.getRoomInfo(request.params.id),
        members: roomManager.getMembers(request.params.id),
      });
    } catch (error) {
      return badRequest(
        reply,
        error instanceof Error ? error.message : "Unable to accept Room invitation",
      );
    }
  });

  app.post<{ Params: { id: string } }>("/api/rooms/:id/decline", (request, reply) => {
    const callerHubId = requireAuthenticatedHub(request, reply, registry, jwtSecret);
    if (!callerHubId) return;
    try {
      const invitation = roomManager.respondToInvitation(
        request.params.id,
        callerHubId,
        "declined",
      );
      return reply.send({ invitation });
    } catch (error) {
      return badRequest(
        reply,
        error instanceof Error ? error.message : "Unable to decline Room invitation",
      );
    }
  });

  app.post<{ Params: { id: string } }>("/api/rooms/:id/leave", (request, reply) => {
    const callerHubId = requireAuthenticatedHub(request, reply, registry, jwtSecret);
    if (!callerHubId) return;
    if (!roomManager.getRoom(request.params.id))
      return reply.code(404).send({ error: "Room not found" });
    if (!roomManager.isMember(request.params.id, callerHubId)) {
      return reply.code(403).send({ error: "Room membership required" });
    }
    roomManager.leaveRoom(request.params.id, callerHubId);
    return reply.send({ members: roomManager.getMembers(request.params.id) });
  });

  app.post<{ Params: { id: string } }>("/api/rooms/:id/invite", (request, reply) => {
    const callerHubId = requireAuthenticatedHub(request, reply, registry, jwtSecret);
    if (!callerHubId) return;
    const hubId = requiredString(objectBody(request.body), "hubId");
    if (!hubId) return badRequest(reply, "hubId is required");
    if (!roomManager.isCreator(request.params.id, callerHubId)) {
      return reply.code(403).send({ error: "Room administrator required" });
    }
    try {
      const invitation = roomManager.inviteToRoom(request.params.id, hubId, callerHubId);
      const invitedSocket = registry.getSocket(hubId);
      if (invitedSocket)
        sendJson(invitedSocket, {
          type: "room:event",
          roomId: request.params.id,
          event: "invite",
          hubId: callerHubId,
        } satisfies RelayServerMessage);
      return reply.code(201).send({ invitation });
    } catch (error) {
      return badRequest(reply, error instanceof Error ? error.message : "Unable to invite hub");
    }
  });

  app.get("/api/room-invitations", (request, reply) => {
    const callerHubId = requireAuthenticatedHub(request, reply, registry, jwtSecret);
    if (!callerHubId) return;
    return reply.send({ invitations: roomManager.listInvitations(callerHubId) });
  });

  app.delete<{ Params: { id: string; hubId: string } }>(
    "/api/rooms/:id/invitations/:hubId",
    (request, reply) => {
      const callerHubId = requireAuthenticatedHub(request, reply, registry, jwtSecret);
      if (!callerHubId) return;
      if (!roomManager.isCreator(request.params.id, callerHubId)) {
        return reply.code(403).send({ error: "Room administrator required" });
      }
      try {
        return reply.send({
          invitation: roomManager.revokeInvitation(
            request.params.id,
            request.params.hubId,
            callerHubId,
          ),
        });
      } catch (error) {
        return badRequest(
          reply,
          error instanceof Error ? error.message : "Unable to revoke Room invitation",
        );
      }
    },
  );

  app.get("/api/health", (_request, reply) => {
    return reply.send({ ok: true, hubs: registry.list().length });
  });
}
