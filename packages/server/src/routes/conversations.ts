import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AgentRuntime } from "../agent/runtime.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { Repository } from "../db/repository.js";

const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  type: z.enum(["dm", "channel", "group"]).default("dm"),
  agentId: z.string().trim().min(1).optional(),
});
const messageSchema = z.object({
  content: z.string().trim().min(1).max(32_000),
  mentionedAgents: z.array(z.string().min(1)).max(20).optional(),
});
const messageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  before: z.coerce.number().int().positive().optional(),
});

export function registerConversationRoutes(
  app: FastifyInstance,
  repository: Repository,
  registry: AgentRegistry,
  runtime: AgentRuntime,
): void {
  app.get("/api/conversations", async () => {
    return repository.listConversations();
  });

  app.post("/api/conversations", async (req, reply) => {
    const parsed = createConversationSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Invalid conversation", issues: parsed.error.flatten() });
    const fallbackAgentId = registry.list().find((agent) => agent.status !== "offline")?.id;
    const agentId = parsed.data.agentId ?? fallbackAgentId;
    if (!agentId) return reply.code(409).send({ error: "NO_AGENT_AVAILABLE" });
    if (agentId && !registry.get(agentId)) return reply.code(400).send({ error: "Agent not found" });
    const conversation = repository.createConversation(
      parsed.data.title ?? "新会话",
      parsed.data.type,
      agentId,
    );
    reply.code(201);
    return conversation;
  });

  app.delete<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    const deleted = repository.deleteConversation(req.params.id);
    reply.code(deleted ? 200 : 404);
    return { ok: deleted };
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string; before?: string } }>(
    "/api/conversations/:id/messages",
    async (req, reply) => {
      if (!repository.getConversation(req.params.id)) return reply.code(404).send({ error: "Conversation not found" });
      const parsed = messageQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });
      return repository.listMessages(req.params.id, parsed.data.limit, parsed.data.before);
    },
  );

  app.post<{ Params: { id: string } }>("/api/conversations/:id/messages", async (req, reply) => {
    if (!repository.getConversation(req.params.id)) return reply.code(404).send({ error: "Conversation not found" });
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid message", issues: parsed.error.flatten() });
    await runtime.handleUserMessage(req.params.id, parsed.data.content, parsed.data.mentionedAgents);
    const latest = repository.listMessages(req.params.id, 1)[0];
    return reply.code(201).send(latest);
  });
}
