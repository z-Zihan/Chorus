import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/index.js";
import { Repository } from "./db/repository.js";
import { AgentRegistry } from "./agent/registry.js";
import { AgentRuntime } from "./agent/runtime.js";
import { EventHub } from "./ws/events.js";
import { registerWebSocket } from "./ws/handler.js";
import { registerRoutes } from "./routes/index.js";

async function main(): Promise<void> {
  const { config, rootDir } = await loadConfig();
  const dbPath = resolve(rootDir, config.dbPath);

  const { sqlite, db } = createDatabase(dbPath);
  const repository = new Repository({ sqlite, db });
  const registry = new AgentRegistry(repository);
  await registry.initialize(config.agents);

  const events = new EventHub();
  const runtime = new AgentRuntime(repository, registry, events, config);

  const app = Fastify({
    logger: { level: process.env.SERVER_LOG_LEVEL?.trim() || "info" },
  });

  await app.register(cors, { origin: config.cors.origin });
  await app.register(websocket);

  registerRoutes(app, repository, registry, runtime);
  registerWebSocket(app, events, runtime);

  const firstAgent = config.agents[0]?.id;
  if (firstAgent) repository.ensureDefaultConversation(firstAgent);

  const webDist = resolve(rootDir, "packages/web/dist");
  if (existsSync(webDist)) {
    await app.register(staticPlugin, { root: webDist, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.method === "GET" && !request.url.startsWith("/api/") && request.url !== "/ws") {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
  }

  const close = async () => {
    await app.close();
    for (const agent of registry.list()) registry.getAdapter(agent.id)?.destroy?.();
    sqlite.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());

  await app.listen({ host: "0.0.0.0", port: config.port });
  app.log.info(`AgentLink server running on http://localhost:${config.port}`);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
