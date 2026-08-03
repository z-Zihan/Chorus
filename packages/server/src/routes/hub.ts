import type { FastifyInstance } from "fastify";
import type { AgentRegistry } from "../agent/registry.js";
import type { ConnectionManager } from "../hub/connection-manager.js";
import type { HubIdentity } from "../hub/identity.js";
import type { RelayClient } from "../hub/relay-client.js";

export interface HubRouteDependencies {
  identity: HubIdentity;
  relayClient: RelayClient;
  registry: AgentRegistry;
  connectionManager: ConnectionManager;
  hubConfig: import("@agentlink/shared").HubConfig;
  connect: () => Promise<void>;
}

export function registerHubRoutes(
  app: FastifyInstance,
  dependencies: HubRouteDependencies,
): void {
  const { identity, relayClient, registry, connectionManager, hubConfig, connect } = dependencies;

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
