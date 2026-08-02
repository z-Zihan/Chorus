import type { FastifyInstance } from "fastify";
import type { AgentRegistry } from "../agent/registry.js";
import type { HubIdentity } from "../hub/identity.js";
import type { RelayClient } from "../hub/relay-client.js";

export interface HubRouteDependencies {
  identity: HubIdentity;
  relayClient: RelayClient;
  registry: AgentRegistry;
  connect: () => Promise<void>;
}

export function registerHubRoutes(
  app: FastifyInstance,
  dependencies: HubRouteDependencies,
): void {
  const { identity, relayClient, registry, connect } = dependencies;

  app.get("/api/hub/status", async () => ({
    hubId: identity.getPublicKey(),
    state: relayClient.state,
    hubs: registry.getKnownHubs().filter((hub) => hub.hubId !== identity.hubId),
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
