import type { AppConfig } from "@agentlink/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { AgentRegistry } from "../../agent/registry";
import { AgentRuntime } from "../../agent/runtime";
import { createDatabase } from "../../db";
import { Repository } from "../../db/repository";
import { EventHub } from "../../ws/events";
import { registerRoutes } from "../index";
import { Scheduler } from "../../scheduler";

const testConfig: AppConfig = {
  port: 0,
  dbPath: ":memory:",
  cors: { origin: [] },
  auth: { enabled: false, tokens: {} },
  history: { maxMessages: 20, maxTokens: 8_000 },
  agents: [
    {
      id: "test-agent",
      name: "Test Agent",
      type: "mock",
      config: { delayMs: 0 },
    },
    {
      id: "second-agent",
      name: "Second Agent",
      type: "mock",
      config: { delayMs: 0 },
    },
  ],
};

export async function buildTestApp(): Promise<FastifyInstance> {
  const database = createDatabase(":memory:");
  const repository = new Repository(database);
  await repository.getOrCreateLocalUser("Test User");
  const registry = new AgentRegistry(repository);
  await registry.initialize(testConfig.agents);

  const app = Fastify({ logger: false });
  const runtime = new AgentRuntime(repository, registry, new EventHub(), testConfig);
  const scheduler = new Scheduler(repository, runtime);
  scheduler.initialize();
  registerRoutes(app, repository, registry, runtime, scheduler);
  app.addHook("onClose", async () => {
    scheduler.destroy();
    for (const agent of registry.list()) registry.getAdapter(agent.id)?.destroy?.();
    database.sqlite.close();
  });
  await app.ready();
  return app;
}
