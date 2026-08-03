import type { AgentConfig } from "@agentlink/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AgentRegistry } from "../agent/registry.js";
import { setCredential } from "../credential-store.js";

const agentTypeSchema = z.enum(["openai", "openclaw", "dify", "cli", "mock", "custom", "langchain"]);
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
}).partial().extend({ disabled: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export function registerAgentRoutes(app: FastifyInstance, registry: AgentRegistry): void {
  app.get<{ Querystring: { includeDisabled?: string } }>("/api/agents", async (request) => {
    return registry.list(request.query.includeDisabled === "true").map(stripApiKey);
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const agent = registry.get(req.params.id, true);
    if (!agent) {
      reply.code(404);
      return { error: "Agent not found" };
    }
    return stripApiKey(agent);
  });

  app.post("/api/agents", async (req, reply) => {
    const parsed = createAgentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid Agent", issues: parsed.error.flatten() });
    if (registry.get(parsed.data.id)) return reply.code(409).send({ error: "Agent already exists" });
    const agent = await registry.registerAndPersist(parsed.data as AgentConfig);
    return reply.code(201).send(stripApiKey(agent));
  });

  app.patch<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const parsed = updateAgentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid update", issues: parsed.error.flatten() });
    const { disabled, ...updates } = parsed.data;
    const apiKey = updates.config?.apiKey;
    if (typeof apiKey === "string" && apiKey.trim()) {
      if (!registry.get(req.params.id, true)) {
        return reply.code(404).send({ error: "Agent not found" });
      }
      await setCredential(req.params.id, apiKey.trim());
    }
    let agent;
    if (Object.keys(updates).length > 0) {
      agent = await registry.update(req.params.id, updates);
    }
    if (disabled !== undefined) {
      agent = disabled
        ? await registry.disable(req.params.id)
        : await registry.enable(req.params.id);
    }
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    return stripApiKey(agent);
  });

  app.delete<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    if (!registry.get(req.params.id, true)) return reply.code(404).send({ error: "Agent not found" });
    return { ok: await registry.unregisterAndDelete(req.params.id) };
  });

  app.get("/api/credentials", async () => registry.getCredentialStatus());

  app.delete("/api/credentials", async () => {
    await registry.clearAllCredentials();
    return { ok: true };
  });
}

function stripApiKey<T>(agent: T): T {
  if (!agent || typeof agent !== "object" || !("config" in agent)) return agent;
  const candidate = agent as T & { config?: Record<string, unknown> };
  if (!candidate.config) return agent;
  const config = { ...candidate.config };
  delete config.apiKey;
  return { ...candidate, config };
}
