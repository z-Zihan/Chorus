import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
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
import { flushAnalytics, track } from "./analytics.js";
import { logger } from "./utils/logger.js";
import { CliDetector } from "./cli-detector/index.js";
import { OnboardingService } from "./routes/onboarding.js";
import { Scheduler } from "./scheduler/index.js";

process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  track("error", { message: error.message, source: "uncaughtException" });
  void flushAnalytics().finally(() => process.exit(1));
});

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  logger.error({ err: error }, "Unhandled promise rejection");
  track("error", { message: error.message, source: "unhandledRejection" });
});

async function main(): Promise<void> {
  const { config, rootDir } = await loadConfig();
  const dbPath = resolve(rootDir, config.dbPath);

  const { sqlite, db } = createDatabase(dbPath);
  const repository = new Repository({ sqlite, db });
  const registry = new AgentRegistry(repository);
  await registry.initialize(config.agents);

  const events = new EventHub();
  const runtime = new AgentRuntime(repository, registry, events, config);
  const scheduler = new Scheduler(repository, runtime);
  scheduler.initialize();
  const detector = new CliDetector();
  const onboarding = new OnboardingService(repository, registry, detector);

  const app = Fastify({ loggerInstance: logger as FastifyBaseLogger });

  app.addHook("onRequest", async (request) => {
    request.log.info({ method: request.method, url: request.url }, "Request received");
  });
  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      { method: request.method, url: request.url, statusCode: reply.statusCode },
      "Request completed",
    );
  });

  await app.register(cors, { origin: config.cors.origin });
  await app.register(websocket);

  registerRoutes(app, repository, registry, runtime, scheduler, detector, onboarding);
  registerWebSocket(app, events, runtime, registry);

  const hasAgentsAtStartup = registry.list().length > 0;
  if (hasAgentsAtStartup) await onboarding.bootstrap();

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
    scheduler.destroy();
    for (const agent of registry.list()) registry.getAdapter(agent.id)?.destroy?.();
    sqlite.close();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());

  await app.listen({ host: "0.0.0.0", port: config.port });
  app.log.info(`AgentLink server running on http://localhost:${config.port}`);
  if (!hasAgentsAtStartup) {
    void onboarding.bootstrap().catch((error) => {
      app.log.error({ err: error }, "Automatic CLI detection failed");
    });
  }
}

main().catch((err) => {
  const error = err instanceof Error ? err : new Error(String(err));
  logger.fatal({ err: error }, "Fatal startup error");
  track("error", { message: error.message, source: "startup" });
  process.exit(1);
});
