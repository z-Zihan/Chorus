import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AgentRuntime } from "../agent/runtime.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { Repository } from "../db/repository.js";

const createConversationSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .nullish()
    .transform((value) => value ?? undefined)
    .optional(),
  type: z.enum(["dm", "channel", "group"]).default("dm"),
  agentIds: z.array(z.string().trim().min(1)).max(20).optional(),
  agentId: z.string().trim().min(1).optional(),
});
const messageSchema = z.object({
  content: z.string().trim().min(1).max(32_000),
  agentId: z.string().trim().min(1).optional(),
  mentionedAgents: z.array(z.string().min(1)).max(20).optional(),
});
const membersSchema = z.object({
  agentIds: z.array(z.string().trim().min(1)).min(1).max(20),
});
const messageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  before: z.coerce.number().int().positive().optional(),
});
const updateConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");
const conversationQuerySchema = z.object({
  archived: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  type: z.enum(["dm", "channel", "group"]).optional(),
});
const a2aPermissionSchema = z.object({
  mode: z.enum(["auto", "confirm", "deny"]),
});
const a2aModeSchema = z.object({
  mode: z.enum(["mention", "call", "off"]),
});
const a2aConfirmationSchema = z.object({
  threadId: z.string().trim().min(1),
  approved: z.boolean(),
});

export function registerConversationRoutes(
  app: FastifyInstance,
  repository: Repository,
  registry: AgentRegistry,
  runtime: AgentRuntime,
): void {
  app.get("/api/conversations", async (request, reply) => {
    const parsed = conversationQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });
    return repository.listConversations({ archived: parsed.data.archived, type: parsed.data.type });
  });

  app.patch<{ Params: { id: string } }>("/api/conversations/:id", async (request, reply) => {
    const parsed = updateConversationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid update", issues: parsed.error.flatten() });
    }
    const conversation = repository.updateConversation(request.params.id, parsed.data);
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
    return conversation;
  });

  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id/a2a-permission",
    async (request, reply) => {
      if (!repository.getConversation(request.params.id)) {
        return reply.code(404).send({ error: "Conversation not found" });
      }
      return { mode: runtime.getA2APermission(request.params.id) };
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/conversations/:id/a2a-permission",
    async (request, reply) => {
      if (!repository.getConversation(request.params.id)) {
        return reply.code(404).send({ error: "Conversation not found" });
      }
      const parsed = a2aPermissionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid A2A permission", issues: parsed.error.flatten() });
      }
      runtime.setA2APermission(request.params.id, parsed.data.mode);
      return { mode: parsed.data.mode };
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/api/conversations/:id/a2a-mode",
    async (request, reply) => {
      const parsed = a2aModeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid A2A mode", issues: parsed.error.flatten() });
      }
      const conversation = repository.updateConversation(request.params.id, {
        a2aMode: parsed.data.mode,
      });
      if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
      return { mode: conversation.a2aMode };
    },
  );

  app.post("/api/a2a/confirm", async (request, reply) => {
    const parsed = a2aConfirmationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid A2A confirmation", issues: parsed.error.flatten() });
    }
    if (!runtime.confirmA2A(parsed.data.threadId, parsed.data.approved)) {
      return reply.code(404).send({ error: "A2A confirmation not found or expired" });
    }
    return { ok: true };
  });

  app.post("/api/conversations", async (req, reply) => {
    const parsed = createConversationSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return reply
        .code(400)
        .send({ error: "Invalid conversation", issues: parsed.error.flatten() });
    const requestedAgentIds =
      parsed.data.agentIds ?? (parsed.data.agentId ? [parsed.data.agentId] : undefined);
    const fallbackAgentId = registry.getOnlineAgents()[0]?.id;
    const agentIds = [
      ...new Set(
        requestedAgentIds?.length ? requestedAgentIds : fallbackAgentId ? [fallbackAgentId] : [],
      ),
    ];
    if (agentIds.length === 0) return reply.code(409).send({ error: "NO_AGENT_AVAILABLE" });
    if (agentIds.some((agentId) => !registry.get(agentId))) {
      return reply.code(400).send({ error: "Agent not found" });
    }
    const conversation = repository.createConversation(
      parsed.data.title ?? "新会话",
      parsed.data.type,
      agentIds,
    );
    reply.code(201);
    return conversation;
  });

  app.post<{ Params: { id: string; agentId: string } }>(
    "/api/conversations/:id/agents/:agentId",
    async (req, reply) => {
      if (!repository.getConversation(req.params.id)) {
        return reply.code(404).send({ error: "Conversation not found" });
      }
      if (!registry.get(req.params.agentId)) {
        return reply.code(404).send({ error: "Agent not found" });
      }
      const conversation = repository.addAgentToConversation(req.params.id, req.params.agentId);
      return reply.code(201).send(conversation);
    },
  );

  app.get<{ Params: { id: string } }>("/api/conversations/:id/members", async (req, reply) => {
    if (!repository.getConversation(req.params.id)) {
      return reply.code(404).send({ error: "Conversation not found" });
    }
    return repository.getConversationMembers(req.params.id);
  });

  app.post<{ Params: { id: string } }>("/api/conversations/:id/members", async (req, reply) => {
    const conversation = repository.getConversation(req.params.id);
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
    const parsed = membersSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid members", issues: parsed.error.flatten() });
    }
    const agentIds = [...new Set(parsed.data.agentIds)];
    if (agentIds.some((agentId) => !registry.get(agentId))) {
      return reply.code(404).send({ error: "Agent not found" });
    }
    if (new Set([...conversation.agentIds, ...agentIds]).size > 20) {
      return reply.code(400).send({ error: "A conversation can have at most 20 agents" });
    }
    const updated = repository.addAgentsToConversation(req.params.id, agentIds);
    return reply.code(201).send(updated);
  });

  app.delete<{ Params: { id: string; agentId: string } }>(
    "/api/conversations/:id/members/:agentId",
    async (req, reply) => {
      const conversation = repository.removeAgentsFromConversation(req.params.id, [
        req.params.agentId,
      ]);
      if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
      return conversation;
    },
  );

  app.delete<{ Params: { id: string; agentId: string } }>(
    "/api/conversations/:id/agents/:agentId",
    async (req, reply) => {
      const conversation = repository.removeAgentFromConversation(
        req.params.id,
        req.params.agentId,
      );
      if (!conversation) return reply.code(404).send({ error: "Conversation not found" });
      return conversation;
    },
  );

  app.delete<{ Params: { id: string } }>("/api/conversations/:id", async (req, reply) => {
    const deleted = repository.deleteConversation(req.params.id);
    reply.code(deleted ? 200 : 404);
    return { ok: deleted };
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string; before?: string } }>(
    "/api/conversations/:id/messages",
    async (req, reply) => {
      if (!repository.getConversation(req.params.id))
        return reply.code(404).send({ error: "Conversation not found" });
      const parsed = messageQuerySchema.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid query" });
      return repository.listMessages(req.params.id, parsed.data.limit, parsed.data.before);
    },
  );

  app.post<{ Params: { id: string } }>("/api/conversations/:id/messages", async (req, reply) => {
    if (!repository.getConversation(req.params.id))
      return reply.code(404).send({ error: "Conversation not found" });
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid message", issues: parsed.error.flatten() });
    await runtime.handleUserMessage(
      req.params.id,
      parsed.data.content,
      parsed.data.mentionedAgents,
      parsed.data.agentId,
    );
    const latest = repository.listMessages(req.params.id, 1)[0];
    return reply.code(201).send(latest);
  });
}
