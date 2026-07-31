import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/api/health", async () => {
    return { ok: true, timestamp: Date.now() };
  });
}
