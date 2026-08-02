import type { FastifyInstance } from "fastify";
import type { AgentRegistry } from "../agent/registry.js";
import type { AgentRuntime } from "../agent/runtime.js";

export function registerMetricsRoutes(
  app: FastifyInstance,
  registry: AgentRegistry,
  runtime: AgentRuntime,
): void {
  app.get<{ Params: { id: string } }>("/api/agents/:id/metrics", async (request, reply) => {
    if (!registry.get(request.params.id, true)) {
      return reply.code(404).send({ error: "Agent not found" });
    }
    return runtime.getMetrics(request.params.id);
  });

  app.get("/api/metrics", async () => runtime.getMetrics());
}
