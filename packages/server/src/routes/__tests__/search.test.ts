import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentRegistry } from "../../agent/registry";
import { AgentRuntime } from "../../agent/runtime";
import { createDatabase } from "../../db";
import { Repository } from "../../db/repository";
import { EventHub } from "../../ws/events";
import { registerRoutes } from "../index";
import { Scheduler } from "../../scheduler";
import type { AppConfig } from "@chorus/shared";

const testConfig: AppConfig = {
  port: 0,
  dbPath: ":memory:",
  cors: { origin: [] },
  auth: { enabled: false, tokens: {} },
  history: { maxMessages: 20, maxTokens: 8_000 },
  agents: [{ id: "test-agent", name: "Test Agent", type: "mock", config: { delayMs: 0 } }],
};

describe("message search", () => {
  let app: FastifyInstance;
  let repository: Repository;

  beforeEach(async () => {
    const database = createDatabase(":memory:");
    repository = new Repository(database);
    await repository.getOrCreateLocalUser("Test User");
    const registry = new AgentRegistry(repository);
    await registry.initialize(testConfig.agents);
    app = Fastify({ logger: false });
    const runtime = new AgentRuntime(repository, registry, new EventHub(), testConfig);
    const scheduler = new Scheduler(repository, runtime);
    scheduler.initialize();
    registerRoutes(app, repository, registry, runtime, scheduler);
    app.addHook("onClose", async () => {
      scheduler.destroy();
      database.sqlite.close();
    });
    await app.ready();

    const conversation = repository.createConversation("Search test", "group", ["test-agent"]);
    const messages = [
      { fromType: "user", fromId: "user", content: "Redis 默认端口是多少？" },
      { fromType: "agent", fromId: "test-agent", content: "默认端口是 6379", status: "done" },
      { fromType: "user", fromId: "user", content: "PostgreSQL port 5432" },
    ];
    for (const [index, message] of messages.entries()) {
      repository.saveMessage({
        id: `msg-${index}`,
        conversationId: conversation.id,
        toType: message.fromType === "user" ? "agent" : "user",
        toId: message.fromType === "user" ? "test-agent" : "user",
        status: message.status ?? "done",
        timestamp: Date.now() + index,
        ...message,
      } as Parameters<Repository["saveMessage"]>[0]);
    }
  });

  afterEach(async () => {
    await app.close();
  });

  it("finds CJK substrings that the unicode61 tokenizer cannot segment", async () => {
    const response = await request(app.server).get("/api/messages/search").query({ q: "默认端口" });

    expect(response.status).toBe(200);
    const results = response.body as Array<{ message: { content: string } }>;
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.some((result) => result.message.content.includes("默认端口"))).toBe(true);
  });

  it("still routes ASCII queries through FTS ranking", async () => {
    const response = await request(app.server).get("/api/messages/search").query({ q: "5432" });

    expect(response.status).toBe(200);
    const results = response.body as Array<{ message: { content: string } }>;
    expect(results).toHaveLength(1);
    expect(results[0]?.message.content).toContain("5432");
  });

  it("escapes LIKE wildcards in CJK queries", async () => {
    const response = await request(app.server).get("/api/messages/search").query({ q: "100%端口" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});
