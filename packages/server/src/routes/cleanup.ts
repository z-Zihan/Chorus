import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Repository } from "../db/repository.js";
import type { Scheduler } from "../scheduler/index.js";

const batchDeleteSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(500),
});

export function registerCleanupRoutes(
  app: FastifyInstance,
  repository: Repository,
  scheduler?: Scheduler,
): void {
  app.delete("/api/conversations/batch", async (request, reply) => {
    const parsed = batchDeleteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid conversation IDs", issues: parsed.error.flatten() });
    }
    const count = repository.deleteConversations(parsed.data.ids);
    for (const id of parsed.data.ids) scheduler?.cancelByConversation(id);
    return { count };
  });
}
