import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CatalogService } from "../catalog/index.js";
import type { InstallExecutor } from "../catalog/installer.js";

const installOptionsSchema = z.object({
  recipeMethod: z.enum(["brew", "npm", "winget", "download"]).optional(),
  apiKey: z.string().trim().max(20_000).optional(),
  config: z.record(z.unknown()).optional(),
  acceptPermissions: z.boolean().optional(),
}).default({});

export function registerCatalogRoutes(
  app: FastifyInstance,
  catalog: CatalogService,
  installer: InstallExecutor,
): void {
  app.get("/api/catalog", async () => catalog.list());

  app.get<{ Params: { id: string } }>("/api/catalog/:id", async (request, reply) => {
    const entry = await catalog.get(request.params.id);
    if (!entry) return reply.code(404).send({ error: "CATALOG_ENTRY_NOT_FOUND" });
    return entry;
  });

  app.post<{ Params: { id: string } }>("/api/catalog/:id/install", async (request, reply) => {
    const parsed = installOptionsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INSTALL_OPTIONS", issues: parsed.error.flatten() });
    }
    try {
      return reply.code(202).send(installer.install(request.params.id, parsed.data));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(message === "CATALOG_ENTRY_NOT_FOUND" ? 404 : 400).send({ error: message });
    }
  });

  app.get<{ Params: { id: string } }>("/api/installations/:id", async (request, reply) => {
    const installation = installer.get(request.params.id);
    if (!installation) return reply.code(404).send({ error: "INSTALLATION_NOT_FOUND" });
    return installation;
  });

  app.post<{ Params: { id: string } }>("/api/installations/:id/cancel", async (request, reply) => {
    const installation = installer.cancel(request.params.id);
    if (!installation) return reply.code(404).send({ error: "INSTALLATION_NOT_FOUND" });
    return installation;
  });
}
