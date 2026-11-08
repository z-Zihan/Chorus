import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRegistry } from "../../agent/registry";
import { AgentRuntime } from "../../agent/runtime";
import { createDatabase } from "../../db";
import { Repository } from "../../db/repository";
import { EventHub } from "../../ws/events";
import { registerRoutes } from "../index";
import { Scheduler } from "../../scheduler";
import type * as SearchModule from "../../db/search.js";
import type { AppConfig } from "@chorus/shared";

// The route imports searchMessages from ../db/search.js, which resolves to the
// same module as ../../db/search.js from this file. The mock delegates to the
// real implementation so the behaviour tests below still exercise the
// production SQL, while the passthrough tests can inspect the exact arguments.
const searchMessagesMock = vi.hoisted(() => vi.fn());
vi.mock("../../db/search.js", async (importOriginal) => {
  const actual = await importOriginal<typeof SearchModule>();
  return { searchMessages: searchMessagesMock.mockImplementation(actual.searchMessages) };
});

interface SearchErrorResponse {
  error: string;
  issues: { formErrors: string[]; fieldErrors: Record<string, string[]> };
}

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

  describe("query validation", () => {
    it("rejects a request without q", async () => {
      const response = await request(app.server).get("/api/messages/search");

      expect(response.status).toBe(400);
      const body = response.body as SearchErrorResponse;
      expect(body.error).toBe("Invalid search query");
      expect(body.issues.fieldErrors.q).toEqual(["Required"]);
    });

    it.each(["", "   "])("rejects a blank q %j", async (q) => {
      const response = await request(app.server).get("/api/messages/search").query({ q });

      expect(response.status).toBe(400);
      const body = response.body as SearchErrorResponse;
      expect(body.error).toBe("Invalid search query");
      expect(body.issues.fieldErrors.q).toHaveLength(1);
    });

    it("rejects a q longer than 500 characters", async () => {
      const response = await request(app.server)
        .get("/api/messages/search")
        .query({ q: "a".repeat(501) });

      expect(response.status).toBe(400);
      const body = response.body as SearchErrorResponse;
      expect(body.error).toBe("Invalid search query");
      expect(body.issues.fieldErrors.q).toHaveLength(1);
    });

    it("accepts a q of exactly 500 characters", async () => {
      const response = await request(app.server)
        .get("/api/messages/search")
        .query({ q: "z".repeat(500) });

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it.each(["0", "201", "1.5", "abc"])("rejects an invalid limit %s", async (limit) => {
      const response = await request(app.server)
        .get("/api/messages/search")
        .query({ q: "默认端口", limit });

      expect(response.status).toBe(400);
      const body = response.body as SearchErrorResponse;
      expect(body.error).toBe("Invalid search query");
      expect(body.issues.fieldErrors.limit).toHaveLength(1);
    });

    it.each([
      { limit: "1", expected: 1 },
      { limit: "50", expected: 2 },
      { limit: "200", expected: 2 },
    ])("accepts limit $limit and applies it to the result set", async ({ limit, expected }) => {
      const response = await request(app.server)
        .get("/api/messages/search")
        .query({ q: "默认端口", limit });

      expect(response.status).toBe(200);
      const results = response.body as Array<{ message: { content: string } }>;
      expect(results).toHaveLength(expected);
    });

    it("rejects an unparseable start_date with an Invalid date issue", async () => {
      const response = await request(app.server)
        .get("/api/messages/search")
        .query({ q: "默认端口", start_date: "not-a-date" });

      expect(response.status).toBe(400);
      const body = response.body as SearchErrorResponse;
      expect(body.error).toBe("Invalid search query");
      expect(body.issues.fieldErrors.start_date).toEqual(["Invalid date"]);
    });

    it("accepts an ISO start_date before the seeded messages", async () => {
      const response = await request(app.server)
        .get("/api/messages/search")
        .query({ q: "默认端口", start_date: "2026-01-01" });

      expect(response.status).toBe(200);
      const results = response.body as Array<{ message: { content: string } }>;
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("accepts a numeric-timestamp start_date", async () => {
      const response = await request(app.server)
        .get("/api/messages/search")
        .query({ q: "默认端口", start_date: "1700000000000" });

      expect(response.status).toBe(200);
      const results = response.body as Array<{ message: { content: string } }>;
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("accepts a 20-digit end_date because Number() parses it as a finite 1e20", async () => {
      const response = await request(app.server)
        .get("/api/messages/search")
        .query({ q: "默认端口", end_date: "99999999999999999999" });

      expect(response.status).toBe(200);
      const results = response.body as Array<{ message: { content: string } }>;
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("rejects an end_date that Number() maps to Infinity", async () => {
      const response = await request(app.server)
        .get("/api/messages/search")
        .query({ q: "默认端口", end_date: "1e999" });

      expect(response.status).toBe(400);
      const body = response.body as SearchErrorResponse;
      expect(body.error).toBe("Invalid search query");
    });

    it("rejects an empty conversation_id instead of treating it as absent", async () => {
      const response = await request(app.server)
        .get("/api/messages/search")
        .query({ q: "5432", conversation_id: "" });

      expect(response.status).toBe(400);
      const body = response.body as SearchErrorResponse;
      expect(body.issues.fieldErrors.conversation_id).toHaveLength(1);
    });

    it("rejects an empty agent_id instead of treating it as absent", async () => {
      const response = await request(app.server)
        .get("/api/messages/search")
        .query({ q: "5432", agent_id: "" });

      expect(response.status).toBe(400);
      const body = response.body as SearchErrorResponse;
      expect(body.issues.fieldErrors.agent_id).toHaveLength(1);
    });
  });

  describe("parameter passthrough", () => {
    it("maps every validated query field onto the searchMessages arguments", async () => {
      searchMessagesMock.mockClear();
      const conversationId = repository.listConversations()[0]?.id;
      expect(conversationId).toBeDefined();

      const response = await request(app.server).get("/api/messages/search").query({
        q: "默认端口",
        conversation_id: conversationId,
        agent_id: "test-agent",
        start_date: "1700000000000",
        end_date: "2026-12-31",
        limit: "5",
      });

      expect(response.status).toBe(200);
      expect(searchMessagesMock).toHaveBeenCalledTimes(1);
      const call = searchMessagesMock.mock.calls.at(0);
      expect(call?.[0]).toBe(repository.context);
      expect(call?.[1]).toBe(repository);
      expect(call?.[2]).toBe("默认端口");
      expect(call?.[3]).toStrictEqual({
        conversationId,
        agentId: "test-agent",
        startDate: 1_700_000_000_000,
        endDate: 1_798_675_200_000,
        limit: 5,
      });
    });

    it("leaves unspecified optional filters as undefined keys in the options object", async () => {
      searchMessagesMock.mockClear();
      const response = await request(app.server).get("/api/messages/search").query({ q: "5432" });

      expect(response.status).toBe(200);
      expect(searchMessagesMock).toHaveBeenCalledTimes(1);
      const call = searchMessagesMock.mock.calls.at(0);
      expect(call?.[2]).toBe("5432");
      expect(call?.[3]).toStrictEqual({
        conversationId: undefined,
        agentId: undefined,
        startDate: undefined,
        endDate: undefined,
        limit: undefined,
      });
    });
  });
});
