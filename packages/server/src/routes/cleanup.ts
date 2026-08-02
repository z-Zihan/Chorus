import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Repository } from "../db/repository.js";

const batchDeleteSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(500),
});

export function registerCleanupRoutes(app: FastifyInstance, repository: Repository): void {
  app.delete("/api/conversations/batch", async (request, reply) => {
    const parsed = batchDeleteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid conversation IDs", issues: parsed.error.flatten() });
    }
    return { count: repository.deleteConversations(parsed.data.ids) };
  });
}
