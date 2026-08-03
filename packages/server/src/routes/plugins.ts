import type { FastifyInstance } from "fastify";
import type { PluginLoader } from "../plugins/loader.js";

export function registerPluginRoutes(app: FastifyInstance, loader?: PluginLoader): void {
  app.get("/api/plugins", async () => {
    if (!loader) return [];
    return loader.listLoaded();
  });
}
