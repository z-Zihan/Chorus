import type { FastifyInstance } from "fastify";
import { LOG_LEVELS, LOG_SOURCES } from "@chorus/shared";
import { z } from "zod";
import { getServerLogs, ingestLogEntries } from "../utils/logger.js";

const logQuerySchema = z.object({
  level: z.enum(LOG_LEVELS).optional(),
  source: z.enum(LOG_SOURCES).optional(),
  limit: z.coerce.number().int().min(1).max(2_000).default(500),
});

const clientLogSchema = z.object({
  id: z.string().max(100).optional(),
  timestamp: z.number().int().nonnegative(),
  level: z.enum(LOG_LEVELS),
  message: z.string().max(20_000),
  data: z.unknown().optional(),
});

const clientLogBatchSchema = z.object({
  entries: z.array(clientLogSchema).min(1).max(100),
});

export function registerLogRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { level?: string; limit?: string } }>(
    "/api/logs",
    async (request, reply) => {
      const parsed = logQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid log query" });
      return getServerLogs(parsed.data.level, parsed.data.limit, parsed.data.source);
    },
  );

  app.post("/api/logs/client", async (request, reply) => {
    const parsed = clientLogBatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid client log batch" });
    ingestLogEntries(
      parsed.data.entries.map((entry) => ({
        ...entry,
        source: "frontend" as const,
      })),
    );
    return reply.code(202).send({ accepted: parsed.data.entries.length });
  });
}
