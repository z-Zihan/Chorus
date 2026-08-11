import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getServerLogs } from "../utils/logger.js";

const logQuerySchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(500),
});

export function registerLogRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { level?: string; limit?: string } }>(
    "/api/logs",
    async (request, reply) => {
      const parsed = logQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid log query" });
      return getServerLogs(parsed.data.level, parsed.data.limit);
    },
  );
}
