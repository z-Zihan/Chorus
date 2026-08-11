import type { FastifyInstance } from "fastify";
import type { HubConfig, P2PDiscoveredHub } from "@chorus/shared";
import type { AgentRegistry } from "../agent/registry.js";
import { getUserKey } from "../credential-store.js";
import type { Repository } from "../db/repository.js";
import type { ConnectionManager } from "../hub/connection-manager.js";
import type { HubIdentity } from "../hub/identity.js";
import { createOwnerProof } from "../hub/owner-proof.js";
import type { P2PListener } from "../hub/p2p-listener.js";
import type { RelayClient } from "../hub/relay-client.js";

const HUB_CONFIG_SETTING_KEY = "hub.config";
const P2P_DISMISSED_SETTING_KEY = "hub.p2p.dismissed";

interface RoutableP2PListener extends P2PListener {
  listeningPort?: number;
}

export interface HubRouteDependencies {
  identity: HubIdentity;
  repository: Repository;
  relayClient: RelayClient;
  registry: AgentRegistry;
  connectionManager: ConnectionManager;
  hubConfig: HubConfig;
  connect: () => Promise<void>;
}

export function registerHubRoutes(app: FastifyInstance, dependencies: HubRouteDependencies): void {
  const { identity, repository, relayClient, registry, connectionManager, hubConfig, connect } =
    dependencies;

  const savedConfig = parseObject(repository.getSetting(HUB_CONFIG_SETTING_KEY));
  applyPersistedConfig(hubConfig, savedConfig);

  const dismissedHubIds = new Set(
    parseStringArray(repository.getSetting(P2P_DISMISSED_SETTING_KEY)),
  );
  const approvedHubIds = new Set<string>();
  const discoveredPeers = new Map<string, P2PDiscoveredHub>();
  const listener = (connectionManager as unknown as { p2pListener: RoutableP2PListener })
    .p2pListener;

  // P2P discovery is owned by the server bootstrap. Intercept its listener calls here so
  // discovery remains passive until the user approves a device through the API.
  const connectToHub = listener.connectToHub.bind(listener);
  const setPeerPublicKey = listener.setPeerPublicKey.bind(listener);
  listener.setPeerPublicKey = (hubId, publicKey) => {
    if (approvedHubIds.has(hubId)) setPeerPublicKey(hubId, publicKey);
  };
  listener.connectToHub = async (hub) => {
    discoveredPeers.set(hub.hubId, hub);
    if (dismissedHubIds.has(hub.hubId) || !approvedHubIds.has(hub.hubId)) return;
    setPeerPublicKey(hub.hubId, hub.publicKey);
    await connectToHub(hub);
  };

  const findRoomConversation = (id: string) => {
    const directMatch = repository.getConversation(id);
    if (directMatch?.type === "cross_hub" && directMatch.relayRoomId) return directMatch;
    return repository
      .listConversations({ type: "cross_hub" })
      .find((conversation) => conversation.relayRoomId === id);
  };

  const configResponse = () => ({
    displayName: hubConfig.displayName,
    relayUrl: hubConfig.relay.url,
    p2pEnabled: hubConfig.p2p.enabled,
    p2pPort: hubConfig.p2p.port,
  });

  app.get("/api/hub/config", async () => ({
    ...configResponse(),
    hubId: identity.hubId,
  }));

  app.patch("/api/hub/config", async (request, reply) => {
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    const nextConfig = configResponse();
    if (body.displayName !== undefined) {
      if (typeof body.displayName !== "string" || !body.displayName.trim()) {
        return reply.code(400).send({ error: "displayName must be a non-empty string" });
      }
      nextConfig.displayName = body.displayName.trim();
    }
    if (body.relayUrl !== undefined) {
      if (typeof body.relayUrl !== "string" || !body.relayUrl.trim()) {
        return reply.code(400).send({ error: "relayUrl must be a non-empty string" });
      }
      nextConfig.relayUrl = body.relayUrl.trim();
    }
    if (body.p2pEnabled !== undefined) {
      if (typeof body.p2pEnabled !== "boolean") {
        return reply.code(400).send({ error: "p2pEnabled must be a boolean" });
      }
      nextConfig.p2pEnabled = body.p2pEnabled;
    }
    if (body.p2pPort !== undefined) {
      if (
        !Number.isInteger(body.p2pPort) ||
        (body.p2pPort as number) < 1 ||
        (body.p2pPort as number) > 65_535
      ) {
        return reply.code(400).send({ error: "p2pPort must be an integer between 1 and 65535" });
      }
      nextConfig.p2pPort = body.p2pPort as number;
    }

    hubConfig.displayName = nextConfig.displayName;
    hubConfig.relay.url = nextConfig.relayUrl;
    hubConfig.p2p.enabled = nextConfig.p2pEnabled;
    hubConfig.p2p.port = nextConfig.p2pPort;
    repository.setSetting(HUB_CONFIG_SETTING_KEY, JSON.stringify(nextConfig));
    return configResponse();
  });

  const listDiscovered = () =>
    [...discoveredPeers.values()]
      .filter(
        (hub) => !dismissedHubIds.has(hub.hubId) && !connectionManager.isP2PAvailable(hub.hubId),
      )
      .map(({ hubId, displayName }) => ({ hubId, displayName }));

  app.get("/api/hub/p2p/discovered", async () => listDiscovered());

  app.post("/api/hub/p2p/connect", async (request, reply) => {
    const body = parseBody(request.body);
    if (typeof body.hubId !== "string" || !body.hubId.trim()) {
      return reply.code(400).send({ error: "hubId must be a non-empty string" });
    }
    if (!hubConfig.p2p.enabled) {
      return reply.code(409).send({ error: "P2P is disabled" });
    }
    const hubId = body.hubId.trim();
    const hub = discoveredPeers.get(hubId);
    if (!hub || dismissedHubIds.has(hubId)) {
      return reply.code(404).send({ error: "P2P device not found" });
    }
    approvedHubIds.add(hubId);
    setPeerPublicKey(hubId, hub.publicKey);
    try {
      await connectToHub(hub);
      return { ok: true };
    } catch (error) {
      approvedHubIds.delete(hubId);
      return reply.code(502).send({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/hub/p2p/dismiss", async (request, reply) => {
    const body = parseBody(request.body);
    if (typeof body.hubId !== "string" || !body.hubId.trim()) {
      return reply.code(400).send({ error: "hubId must be a non-empty string" });
    }
    const hubId = body.hubId.trim();
    approvedHubIds.delete(hubId);
    dismissedHubIds.add(hubId);
    repository.setSetting(P2P_DISMISSED_SETTING_KEY, JSON.stringify([...dismissedHubIds]));
    return { ok: true };
  });

  app.get("/api/hub/p2p/status", async () => {
    const knownHubs = new Map(registry.getKnownHubs().map((hub) => [hub.hubId, hub]));
    const candidateHubIds = new Set([...knownHubs.keys(), ...discoveredPeers.keys()]);
    const connected = [...candidateHubIds]
      .filter((hubId) => connectionManager.isP2PAvailable(hubId))
      .map((hubId) => ({
        hubId,
        displayName:
          discoveredPeers.get(hubId)?.displayName ??
          knownHubs.get(hubId)?.displayName ??
          hubId.slice(0, 8),
        latency: connectionManager.getConnectionInfo(hubId).p2pLatency,
        status: "connected" as const,
      }));
    return {
      enabled: hubConfig.p2p.enabled,
      port: listener.listeningPort ?? hubConfig.p2p.port,
      connected,
      discovered: listDiscovered(),
    };
  });

  app.post("/api/hub/rooms", async (request, reply) => {
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    if (typeof body.name !== "string" || !body.name.trim()) {
      return reply.code(400).send({ error: "name must be a non-empty string" });
    }
    const room = await relayClient.createRoomRequest(hubConfig.relay.url, body.name.trim());
    repository.createConversation(room.name, "cross_hub", [], room.id, {
      createdByHubId: identity.hubId,
      adminHubIds: [identity.hubId],
    });
    return reply.code(201).send({ roomId: room.id, name: room.name });
  });

  app.get("/api/hub/rooms", async () =>
    repository
      .listConversations({ type: "cross_hub" })
      .filter((conversation) => Boolean(conversation.relayRoomId)),
  );

  app.get<{ Params: { id: string } }>("/api/hub/rooms/:id", async (request, reply) => {
    const conversation = findRoomConversation(request.params.id);
    if (!conversation?.relayRoomId) {
      return reply.code(404).send({ error: "Room not found" });
    }
    const members = await relayClient.getRoomMembersRequest(
      hubConfig.relay.url,
      conversation.relayRoomId,
    );
    const agents = repository.getConversationMembers(conversation.id);
    return {
      ...conversation,
      roomId: conversation.relayRoomId,
      members,
      agents,
      ...repository.getRoomState(conversation.id),
    };
  });

  app.post<{ Params: { id: string } }>("/api/hub/rooms/:id/agents", async (request, reply) => {
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    if (typeof body.agentId !== "string" || !body.agentId.trim()) {
      return reply.code(400).send({ error: "agentId must be a non-empty string" });
    }

    const conversation = findRoomConversation(request.params.id);
    if (!conversation?.relayRoomId) {
      return reply.code(404).send({ error: "Room not found" });
    }
    const agentId = body.agentId.trim();
    const agent = repository.getAgentRow(agentId);
    const localUser = repository.getUser("usr_local");
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    if (!localUser || agent.ownerId !== localUser.id) {
      return reply.code(403).send({ error: "AGENT_OWNER_REQUIRED" });
    }

    const roomState = repository.getRoomState(conversation.id);
    if (!roomState) return reply.code(404).send({ error: "Room state not found" });
    const userKey = await getUserKey();
    if (!userKey) {
      return reply.code(503).send({ error: "Local User key is unavailable" });
    }
    const ownerProof = createOwnerProof(
      agentId,
      localUser.id,
      conversation.relayRoomId,
      roomState.keyEpoch,
      userKey.privateKey,
    );
    const updated = repository.addAgentToConversation(conversation.id, [agentId], {
      [agentId]: JSON.stringify(ownerProof),
    });
    if (!updated) return reply.code(404).send({ error: "Room or Agent not found" });
    repository.incrementRoomRevision(conversation.relayRoomId);
    return { ok: true, agentId, ownerProof };
  });

  app.delete<{ Params: { id: string; agentId: string } }>(
    "/api/hub/rooms/:id/agents/:agentId",
    async (request, reply) => {
      const conversation = findRoomConversation(request.params.id);
      if (!conversation?.relayRoomId) {
        return reply.code(404).send({ error: "Room not found" });
      }
      const membership = repository
        .getConversationMembers(conversation.id)
        .find((agent) => agent.id === request.params.agentId);
      if (!membership) return reply.code(404).send({ error: "Room Agent not found" });

      const localUser = repository.getUser("usr_local");
      const isOwner = Boolean(localUser && membership.ownerId === localUser.id);
      let isAdministrator = isLocalRoomAdministrator(
        conversation.metadata,
        identity.hubId,
        localUser?.id,
      );
      if (!isOwner && !isAdministrator) {
        const room = await relayClient.getRoomRequest?.(
          hubConfig.relay.url,
          conversation.relayRoomId,
        );
        isAdministrator = room?.createdBy === identity.hubId;
      }
      if (!isOwner && !isAdministrator) {
        return reply.code(403).send({ error: "ROOM_ADMIN_REQUIRED" });
      }

      const updated = repository.removeAgentFromConversation(
        conversation.id,
        request.params.agentId,
      );
      if (!updated) return reply.code(404).send({ error: "Room not found" });
      repository.incrementRoomRevision(conversation.relayRoomId);
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string } }>("/api/hub/rooms/:id/invite", async (request, reply) => {
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
    if (typeof body.hubId !== "string" || !body.hubId.trim()) {
      return reply.code(400).send({ error: "hubId must be a non-empty string" });
    }
    const invitation = await relayClient.inviteToRoomRequest(
      hubConfig.relay.url,
      request.params.id,
      body.hubId.trim(),
    );
    return { ok: true, invitation };
  });

  app.get("/api/hub/room-invitations", async () => ({
    invitations: (await relayClient.listRoomInvitationsRequest(hubConfig.relay.url)).filter(
      (invitation) =>
        invitation.status === "pending" ||
        (invitation.status === "accepted" && !findRoomConversation(invitation.roomId)),
    ),
  }));

  app.post<{ Params: { id: string } }>(
    "/api/hub/room-invitations/:id/accept",
    async (request, reply) => {
      const result = await relayClient.respondToRoomInvitationRequest(
        hubConfig.relay.url,
        request.params.id,
        "accepted",
      );
      let conversation = findRoomConversation(request.params.id);
      if (!conversation) {
        const room = result.room;
        if (!room) return reply.code(502).send({ error: "Relay did not return the accepted Room" });
        conversation = repository.createConversation(room.name, "cross_hub", [], room.id, {
          createdByHubId: room.createdBy,
          adminHubIds: [room.createdBy],
        });
      }
      relayClient.joinRoom(request.params.id);
      return reply.send({ invitation: result.invitation, conversation });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/hub/room-invitations/:id/decline",
    async (request) => ({
      invitation: (
        await relayClient.respondToRoomInvitationRequest(
          hubConfig.relay.url,
          request.params.id,
          "declined",
        )
      ).invitation,
    }),
  );

  app.get("/api/hub/status", async () => ({
    relayState: relayClient.state,
    peers: registry
      .getKnownHubs()
      .filter((hub) => hub.hubId !== identity.hubId)
      .map((hub) => {
        const connection = connectionManager.getConnectionInfo(hub.hubId);
        return {
          hubId: hub.hubId,
          displayName: hub.displayName,
          path: connection.path,
          latency: connection.path === "p2p" ? connection.p2pLatency : connection.relayLatency,
        };
      }),
  }));

  app.post("/api/hub/connect", async (_request, reply) => {
    try {
      await connect();
      return reply.send({ state: relayClient.state });
    } catch (error) {
      return reply.code(502).send({
        state: relayClient.state,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/hub/disconnect", async () => {
    relayClient.disconnect();
    return { state: relayClient.state };
  });

  app.get("/api/hub/contacts", async () =>
    registry.getKnownHubs().filter((hub) => hub.hubId !== identity.hubId),
  );
}

function isLocalRoomAdministrator(
  metadata: { [key: string]: unknown } | undefined,
  hubId: string,
  userId: string | undefined,
): boolean {
  if (!metadata) return false;
  if (metadata.createdByHubId === hubId || metadata.createdBy === hubId) return true;
  const administrators = [
    metadata.adminHubIds,
    metadata.administratorHubIds,
    metadata.adminUserIds,
    metadata.administrators,
  ];
  return administrators.some(
    (value) =>
      Array.isArray(value) &&
      value.some((id) => id === hubId || (userId !== undefined && id === userId)),
  );
}

function parseBody(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function parseObject(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return parseBody(JSON.parse(value));
  } catch {
    return {};
  }
}

function parseStringArray(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && Boolean(item))
      : [];
  } catch {
    return [];
  }
}

function applyPersistedConfig(hubConfig: HubConfig, persisted: Record<string, unknown>): void {
  if (typeof persisted.displayName === "string" && persisted.displayName.trim()) {
    hubConfig.displayName = persisted.displayName.trim();
  }
  if (typeof persisted.relayUrl === "string" && persisted.relayUrl.trim()) {
    hubConfig.relay.url = persisted.relayUrl.trim();
  }
  if (typeof persisted.p2pEnabled === "boolean") {
    hubConfig.p2p.enabled = persisted.p2pEnabled;
  }
  if (
    Number.isInteger(persisted.p2pPort) &&
    (persisted.p2pPort as number) >= 1 &&
    (persisted.p2pPort as number) <= 65_535
  ) {
    hubConfig.p2p.port = persisted.p2pPort as number;
  }
}
