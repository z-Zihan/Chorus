import type { AgentConfig } from "@agentlink/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AgentRegistry } from "../agent/registry.js";
import { setCredential } from "../credential-store.js";
import type { Repository } from "../db/repository.js";

const agentTypeSchema = z.enum(["openai", "openclaw", "dify", "cli", "mock", "custom", "langchain"]);
const createAgentSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[\w-]+$/),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  avatar: z.string().url().max(2_000).optional(),
  type: agentTypeSchema,
  config: z.record(z.unknown()).default({}),
  capabilities: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
});
const updateAgentSchema = createAgentSchema.pick({
  name: true,
  description: true,
  avatar: true,
  config: true,
}).partial().extend({ disabled: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const booleanQuerySchema = z.enum(["true", "false"]).transform((value) => value === "true");
const agentQuerySchema = z.object({
  ownerId: z.string().trim().min(1).optional(),
  ownerType: z.enum(["local", "remote", "system"]).optional(),
  includeRemote: booleanQuerySchema.default("true"),
  includeDisabled: booleanQuerySchema.default("false"),
  status: z.enum(["online", "busy", "offline"]).optional(),
  capability: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
const userQuerySchema = z.object({
  kind: z.enum(["local", "remote"]).optional(),
  includeAgents: booleanQuerySchema.default("false"),
});
const bindUserHubSchema = z.object({
  hubId: z.string().trim().min(1).max(1_000),
  displayName: z.string().trim().min(1).max(200).optional(),
});

export function registerAgentRoutes(
  app: FastifyInstance,
  registry: AgentRegistry,
  repository: Repository,
): void {
  app.get("/api/agents", async (request, reply) => {
    const parsed = agentQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", issues: parsed.error.flatten() });
    }
    return repository.listAgents(parsed.data).map(stripApiKey);
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const agent = registry.get(req.params.id, true);
    if (!agent) {
      reply.code(404);
      return { error: "Agent not found" };
    }
    return stripApiKey(agent);
  });

  app.get("/api/users", async (request, reply) => {
    const parsed = userQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", issues: parsed.error.flatten() });
    }
    return repository.listUsers({ kind: parsed.data.kind }).map((user) => {
      const userWithAgents = repository.getUserWithAgents(user.id);
      if (!userWithAgents) return { ...user, agentCount: 0 };
      if (parsed.data.includeAgents) return userWithAgents;
      const { agents: _agents, ...userWithoutAgents } = userWithAgents;
      return userWithoutAgents;
    });
  });

  app.get<{ Params: { userId: string } }>("/api/users/:userId/agents", async (request, reply) => {
    const user = repository.getUserWithAgents(request.params.userId);
    if (!user) return reply.code(404).send({ error: "User not found" });
    return user.agents.map(stripApiKey);
  });

  app.get<{ Params: { userId: string } }>("/api/users/:userId/hubs", async (request, reply) => {
    if (!repository.getUser(request.params.userId)) {
      return reply.code(404).send({ error: "User not found" });
    }
    return repository.listHubsForUser(request.params.userId);
  });

  app.post<{ Params: { userId: string } }>("/api/users/:userId/hubs", async (request, reply) => {
    if (!repository.getUser(request.params.userId)) {
      return reply.code(404).send({ error: "User not found" });
    }
    const parsed = bindUserHubSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid Hub binding", issues: parsed.error.flatten() });
    }
    const binding = repository.bindUserHub(
      request.params.userId,
      parsed.data.hubId,
      parsed.data.displayName,
    );
    return reply.code(201).send({
      hubId: binding.hubId,
      displayName: binding.hubDisplayName ?? null,
      lastSeenAt: binding.lastSeenAt ?? null,
    });
  });

  app.delete<{ Params: { userId: string; hubId: string } }>(
    "/api/users/:userId/hubs/:hubId",
    async (request, reply) => {
      if (!repository.getUser(request.params.userId)) {
        return reply.code(404).send({ error: "User not found" });
      }
      const unbound = repository.unbindUserHub(request.params.userId, request.params.hubId);
      if (!unbound) return reply.code(404).send({ error: "Hub binding not found" });
      registry.markRemoteAgentsStale(request.params.hubId);
      return { ok: true };
    },
  );

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
