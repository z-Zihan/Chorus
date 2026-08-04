import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AgentRegistry } from "../agent/registry.js";
import { StandardAdapterMapper } from "../hub/standard-adapters.js";

function requestBaseUrl(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}`;
}

export function registerStandardRoutes(
  app: FastifyInstance,
  registry: AgentRegistry,
  mapper = new StandardAdapterMapper(),
): void {
  app.get("/api/.well-known/agent-card.json", async (request) => {
    const baseUrl = requestBaseUrl(request);
    return registry.list().map((agent) => mapper.toAgentCard(agent, baseUrl));
  });

  app.get("/api/mcp/tools", async () => {
    return registry.list().map((agent) => mapper.toMCPTool(agent));
  });

  app.get("/api/acp/services", async (request) => {
    const baseUrl = requestBaseUrl(request);
    return registry.list().map((agent) => mapper.toACPService(agent, baseUrl));
  });
}
