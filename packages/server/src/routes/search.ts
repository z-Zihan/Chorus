import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DatabaseContext } from "../db/index.js";
import type { Repository } from "../db/repository.js";
import { searchMessages } from "../db/search.js";

const dateSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value, context) => {
    const numeric = Number(value);
    const timestamp = Number.isFinite(numeric) ? numeric : Date.parse(value);
    if (!Number.isFinite(timestamp)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date" });
      return z.NEVER;
    }
    return timestamp;
  });

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(500),
  conversation_id: z.string().trim().min(1).optional(),
  agent_id: z.string().trim().min(1).optional(),
  start_date: dateSchema.optional(),
  end_date: dateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export function registerSearchRoutes(
  app: FastifyInstance,
  context: DatabaseContext,
  repository: Repository,
): void {
  app.get("/api/messages/search", async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid search query", issues: parsed.error.flatten() });
    }
    const input = parsed.data;
    return searchMessages(context, repository, input.q, {
      conversationId: input.conversation_id,
      agentId: input.agent_id,
      startDate: input.start_date,
      endDate: input.end_date,
      limit: input.limit,
    });
  });
}
