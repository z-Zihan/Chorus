import type { AgentConfig } from "@agentlink/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AgentRegistry } from "../agent/registry.js";

const agentTypeSchema = z.enum(["openai", "openclaw", "dify", "cli", "mock", "custom"]);
const createAgentSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[\w-]+$/),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  avatar: z.string().url().max(2_000).optional(),
  type: agentTypeSchema,
  config: z.record(z.unknown()).default({}),
});
const updateAgentSchema = createAgentSchema.pick({
  name: true,
  description: true,
  avatar: true,
  config: true,
}).partial().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export function registerAgentRoutes(app: FastifyInstance, registry: AgentRegistry): void {
  app.get("/api/agents", async () => {
    return registry.list();
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const agent = registry.get(req.params.id);
    if (!agent) {
      reply.code(404);
      return { error: "Agent not found" };
    }
    return agent;
  });

  app.post("/api/agents", async (req, reply) => {
    const parsed = createAgentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid Agent", issues: parsed.error.flatten() });
    if (registry.get(parsed.data.id)) return reply.code(409).send({ error: "Agent already exists" });
    const agent = await registry.register(parsed.data as AgentConfig);
    return reply.code(201).send(agent);
  });

  app.patch<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const parsed = updateAgentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid update", issues: parsed.error.flatten() });
    const agent = await registry.update(req.params.id, parsed.data);
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    return agent;
  });

  app.delete<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    if (!registry.get(req.params.id)) return reply.code(404).send({ error: "Agent not found" });
    return { ok: registry.remove(req.params.id) };
  });
}
