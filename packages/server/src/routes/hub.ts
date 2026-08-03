import type { FastifyInstance } from "fastify";
import type { HubConfig } from "@agentlink/shared";
import type { AgentRegistry } from "../agent/registry.js";
import type { ConnectionManager } from "../hub/connection-manager.js";
import type { HubIdentity } from "../hub/identity.js";
import type { RelayClient } from "../hub/relay-client.js";

export interface HubRouteDependencies {
  identity: HubIdentity;
  relayClient: RelayClient;
  registry: AgentRegistry;
  connectionManager: ConnectionManager;
  hubConfig: HubConfig;
  connect: () => Promise<void>;
}

export function registerHubRoutes(
  app: FastifyInstance,
  dependencies: HubRouteDependencies,
): void {
  const { identity, relayClient, registry, connectionManager, hubConfig, connect } = dependencies;

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
    const body = typeof request.body === "object" && request.body !== null
      ? request.body as Record<string, unknown>
      : {};
    if (body.displayName !== undefined) {
      if (typeof body.displayName !== "string" || !body.displayName.trim()) {
        return reply.code(400).send({ error: "displayName must be a non-empty string" });
      }
      hubConfig.displayName = body.displayName.trim();
    }
    if (body.relayUrl !== undefined) {
      if (typeof body.relayUrl !== "string" || !body.relayUrl.trim()) {
        return reply.code(400).send({ error: "relayUrl must be a non-empty string" });
      }
      hubConfig.relay.url = body.relayUrl.trim();
    }
    if (body.p2pEnabled !== undefined) {
      if (typeof body.p2pEnabled !== "boolean") {
        return reply.code(400).send({ error: "p2pEnabled must be a boolean" });
      }
      hubConfig.p2p.enabled = body.p2pEnabled;
    }
    if (body.p2pPort !== undefined) {
      if (!Number.isInteger(body.p2pPort) || (body.p2pPort as number) < 1 || (body.p2pPort as number) > 65_535) {
        return reply.code(400).send({ error: "p2pPort must be an integer between 1 and 65535" });
      }
      hubConfig.p2p.port = body.p2pPort as number;
    }
    return configResponse();
  });

  app.post("/api/hub/rooms", async (request, reply) => {
    const body = typeof request.body === "object" && request.body !== null
      ? request.body as Record<string, unknown>
      : {};
    if (typeof body.name !== "string" || !body.name.trim()) {
      return reply.code(400).send({ error: "name must be a non-empty string" });
    }
    const room = await relayClient.createRoomRequest(hubConfig.relay.url, body.name.trim());
    return reply.code(201).send({ roomId: room.id, name: room.name });
  });

  app.post<{ Params: { id: string } }>("/api/hub/rooms/:id/invite", async (request, reply) => {
    const body = typeof request.body === "object" && request.body !== null
      ? request.body as Record<string, unknown>
      : {};
    if (typeof body.hubId !== "string" || !body.hubId.trim()) {
      return reply.code(400).send({ error: "hubId must be a non-empty string" });
    }
    await relayClient.inviteToRoomRequest(
      hubConfig.relay.url,
      request.params.id,
      body.hubId.trim(),
    );
    return { ok: true };
  });

  app.get("/api/hub/status", async () => ({
    relayState: relayClient.state,
    peers: registry.getKnownHubs()
      .filter((hub) => hub.hubId !== identity.hubId)
      .map((hub) => {
        const connection = connectionManager.getConnectionInfo(hub.hubId);
        return {
          hubId: hub.hubId,
          displayName: hub.displayName,
          path: connection.path,
          latency: connection.path === "p2p"
            ? connection.p2pLatency
            : connection.relayLatency,
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

  app.get("/api/hub/contacts", async () => (
    registry.getKnownHubs().filter((hub) => hub.hubId !== identity.hubId)
  ));
}
