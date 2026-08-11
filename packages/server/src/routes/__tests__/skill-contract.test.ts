import type { AppConfig } from "@chorus/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentRegistry } from "../../agent/registry.js";
import { AgentRuntime } from "../../agent/runtime.js";
import { TokenStore } from "../../auth/token-store.js";
import { createDatabase } from "../../db/index.js";
import { Repository } from "../../db/repository.js";
import { TrustStore } from "../../hub/trust-store.js";
import { EventHub } from "../../ws/events.js";
import { registerAgentRoutes } from "../agents.js";
import { registerConversationRoutes } from "../conversations.js";
import { registerSkillRoutes } from "../skill.js";
import { registerTokenRoutes } from "../tokens.js";
import { registerTrustRoutes } from "../trust.js";

const contractConfig: AppConfig = {
  port: 0,
  dbPath: ":memory:",
  cors: { origin: [] },
  auth: { enabled: false, tokens: {} },
  history: { maxMessages: 20, maxTokens: 8_000 },
  agents: [
    {
      id: "local-agent",
      name: "Local Agent",
      type: "mock",
      config: { delayMs: 0 },
      capabilities: ["chat", "coding"],
    },
    {
      id: "second-agent",
      name: "Second Agent",
      type: "mock",
      config: { delayMs: 0 },
      capabilities: ["chat"],
    },
  ],
};

async function buildContractTestApp(): Promise<FastifyInstance> {
  const database = createDatabase(":memory:");
  const repository = new Repository(database);
  await repository.getOrCreateLocalUser("Local User");

  const registry = new AgentRegistry(repository);
  await registry.initialize(contractConfig.agents);

  repository.upsertRemoteUser({
    id: "usr_remote",
    name: "Remote User",
    hubId: "hub-remote",
    publicKey: "remote-public-key",
    kind: "remote",
    createdAt: 1_000,
    updatedAt: 1_000,
    lastSeenAt: 1_000,
  });
  repository.upsertAgent(
    {
      id: "remote-agent",
      name: "Remote Agent",
      description: "",
      type: "mock",
      config: {},
      source: "user",
      managed: false,
      customizedFields: [],
      disabled: false,
      ownerId: "usr_remote",
      ownerType: "remote",
      capabilities: ["chat"],
      stale: false,
      homeHubId: "hub-remote",
    },
    null,
  );

  const app = Fastify({ logger: false });
  const runtime = new AgentRuntime(repository, registry, new EventHub(), contractConfig);
  const trustStore = new TrustStore(repository);
  const tokenStore = new TokenStore(repository);

  registerAgentRoutes(app, registry, repository);
  registerConversationRoutes(app, repository, registry, runtime);
  registerTrustRoutes(app, trustStore);
  registerSkillRoutes(app);
  registerTokenRoutes(app, tokenStore, contractConfig.auth);

  app.addHook("onClose", async () => {
    for (const agent of registry.list()) registry.getAdapter(agent.id)?.destroy?.();
    database.sqlite.close();
  });
  await app.ready();
  return app;
}

async function createConversation(
  app: FastifyInstance,
  body: { title: string; type?: "dm" | "group" | "cross_hub"; agentIds: string[] },
) {
  return request(app.server).post("/api/conversations").send(body);
}

describe("Chorus SKILL.md contract", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildContractTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("Discovery API", () => {
    it("returns discoverable agents with the documented identity and routing fields", async () => {
      const response = await request(app.server).get("/api/agents");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(expect.any(Array));
      expect(response.body).toHaveLength(3);
      for (const agent of response.body) {
        expect(agent).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            name: expect.any(String),
            type: expect.any(String),
            status: expect.any(String),
            ownerId: expect.any(String),
            ownerType: expect.any(String),
            owner: expect.objectContaining({
              id: expect.any(String),
              name: expect.any(String),
              kind: expect.any(String),
            }),
            capabilities: expect.any(Array),
            stale: expect.any(Boolean),
            homeHubId: expect.any(String),
          }),
        );
      }
    });

    it("excludes remote agents when includeRemote=false", async () => {
      const response = await request(app.server).get("/api/agents?includeRemote=false");

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(
        response.body.every((agent: { ownerType: string }) => agent.ownerType !== "remote"),
      ).toBe(true);
    });

    it("filters agents by ownerId", async () => {
      const response = await request(app.server).get("/api/agents?ownerId=usr_local");

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(
        response.body.every((agent: { ownerId: string }) => agent.ownerId === "usr_local"),
      ).toBe(true);
    });

    it("returns known users with agentCount", async () => {
      const response = await request(app.server).get("/api/users");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "usr_local", agentCount: 2 }),
          expect.objectContaining({ id: "usr_remote", agentCount: 1 }),
        ]),
      );
      expect(response.body.every((user: Record<string, unknown>) => !("agents" in user))).toBe(
        true,
      );
    });

    it("embeds each user's agents when includeAgents=true", async () => {
      const response = await request(app.server).get("/api/users?includeAgents=true");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "usr_local",
            agentCount: 2,
            agents: expect.arrayContaining([
              expect.objectContaining({ id: "local-agent" }),
              expect.objectContaining({ id: "second-agent" }),
            ]),
          }),
          expect.objectContaining({
            id: "usr_remote",
            agentCount: 1,
            agents: [expect.objectContaining({ id: "remote-agent" })],
          }),
        ]),
      );
    });

    it("returns the agents owned by a specified user", async () => {
      const response = await request(app.server).get("/api/users/usr_remote/agents");

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        expect.objectContaining({
          id: "remote-agent",
          ownerId: "usr_remote",
          ownerType: "remote",
          homeHubId: "hub-remote",
        }),
      ]);
    });
  });

  describe("Messaging API", () => {
    it.each([
      ["dm", ["local-agent"]],
      ["group", ["local-agent", "second-agent"]],
      ["cross_hub", ["local-agent", "second-agent"]],
    ] as const)("creates a %s conversation", async (type, agentIds) => {
      const response = await createConversation(app, {
        title: `${type} contract conversation`,
        type,
        agentIds: [...agentIds],
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        id: expect.any(String),
        title: `${type} contract conversation`,
        type,
        agentIds: [...agentIds],
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      });
    });

    it("sends a message and returns the documented message envelope", async () => {
      const conversation = await createConversation(app, {
        title: "Send contract",
        type: "dm",
        agentIds: ["local-agent"],
      });

      const response = await request(app.server)
        .post(`/api/conversations/${conversation.body.id}/messages`)
        .send({ content: "hello contract", agentId: "local-agent" });

      expect(response.status).toBe(201);
      expect(response.body).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          conversationId: conversation.body.id,
          fromType: expect.any(String),
          fromId: expect.any(String),
          toType: expect.any(String),
          toId: expect.any(String),
          content: expect.any(String),
          status: expect.any(String),
          timestamp: expect.any(Number),
        }),
      );
    });

    it("reads message history with sender, recipient, content, status, and timestamp", async () => {
      const conversation = await createConversation(app, {
        title: "History contract",
        type: "dm",
        agentIds: ["local-agent"],
      });
      await request(app.server)
        .post(`/api/conversations/${conversation.body.id}/messages`)
        .send({ content: "persist this message", agentId: "local-agent" });

      const response = await request(app.server).get(
        `/api/conversations/${conversation.body.id}/messages`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body).toEqual([
        expect.objectContaining({
          fromType: "user",
          fromId: "user",
          toType: "agent",
          toId: "local-agent",
          content: "persist this message",
          status: "done",
          timestamp: expect.any(Number),
        }),
        expect.objectContaining({
          fromType: "agent",
          fromId: "local-agent",
          toType: "user",
          toId: "user",
          content: expect.any(String),
          status: "done",
          timestamp: expect.any(Number),
        }),
      ]);
    });
  });

  describe("A2A Mode API", () => {
    it("switches a conversation between mention, call, and off modes", async () => {
      const conversation = await createConversation(app, {
        title: "A2A mode contract",
        type: "group",
        agentIds: ["local-agent", "second-agent"],
      });
      const path = `/api/conversations/${conversation.body.id}/a2a-mode`;

      for (const mode of ["mention", "call", "off"] as const) {
        const response = await request(app.server).patch(path).send({ mode });
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ mode });
      }

      const conversations = await request(app.server).get("/api/conversations");
      expect(conversations.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: conversation.body.id, a2aMode: "off" }),
        ]),
      );
    });

    it("gets and sets the conversation A2A permission", async () => {
      const conversation = await createConversation(app, {
        title: "A2A permission contract",
        type: "dm",
        agentIds: ["local-agent"],
      });
      const path = `/api/conversations/${conversation.body.id}/a2a-permission`;

      const initial = await request(app.server).get(path);
      expect(initial.status).toBe(200);
      expect(initial.body).toEqual({ mode: "auto" });

      const updated = await request(app.server).patch(path).send({ mode: "confirm" });
      expect(updated.status).toBe(200);
      expect(updated.body).toEqual({ mode: "confirm" });

      const persisted = await request(app.server).get(path);
      expect(persisted.body).toEqual({ mode: "confirm" });
    });
  });

  describe("Trust API", () => {
    it("returns the trusted Hub list", async () => {
      const response = await request(app.server).get("/api/trust");

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it("requires the live pairing service to create a pairing package", async () => {
      const response = await request(app.server)
        .post("/api/trust/pair")
        .send({ hubId: "hub-pair" });

      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: "Pairing service is unavailable" });
    });

    it("removes the insecure self-confirmation endpoint", async () => {
      expect((await request(app.server).post("/api/trust/confirm").send({})).status).toBe(404);
    });

    it("blocks a Hub", async () => {
      const response = await request(app.server)
        .post("/api/trust/block")
        .send({ hubId: "hub-blocked" });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        success: true,
        hub: expect.objectContaining({ hubId: "hub-blocked", trustLevel: "blocked" }),
      });
      expect((await request(app.server).get("/api/trust")).body).toEqual([]);
    });

    it("removes a trusted Hub", async () => {
      await request(app.server).post("/api/trust/block").send({ hubId: "hub-remove" });

      const response = await request(app.server).delete("/api/trust/hub-remove");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect((await request(app.server).get("/api/trust")).body).toEqual([]);
    });
  });

  describe("Skill Discovery", () => {
    it("serves the Chorus SKILL.md contract as Markdown", async () => {
      const expected = readFileSync(
        new URL("../../../../../skills/chorus-platform/SKILL.md", import.meta.url),
        "utf8",
      );

      const response = await request(app.server).get("/api/skill");

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toMatch(/^text\/markdown/);
      expect(response.text).toBe(expected);
    });

    it("returns metadata for the available skill", async () => {
      const response = await request(app.server).get("/api/skill/meta");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        available: true,
        title: "Chorus Platform Skill / Chorus 平台接入技能",
        description: expect.stringContaining("Chorus"),
        endpoint: "/api/skill",
        contentType: "text/markdown",
      });
    });
  });

  describe("Token API", () => {
    it("creates a client token from loopback only", async () => {
      const response = await request(app.server)
        .post("/api/tokens")
        .send({ clientId: "contract-client", scopes: ["agents:read"] });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.stringMatching(/^tok_/),
        token: expect.stringMatching(/^tok_[^.]+\./),
      });

      const remote = await app.inject({
        method: "POST",
        url: "/api/tokens",
        remoteAddress: "203.0.113.10",
        payload: { clientId: "remote-client", scopes: [] },
      });
      expect(remote.statusCode).toBe(403);
    });

    it("lists active client tokens from loopback without exposing secrets", async () => {
      const created = await request(app.server)
        .post("/api/tokens")
        .send({ clientId: "list-client", scopes: ["messages:write"] });

      const response = await request(app.server).get("/api/tokens");

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        expect.objectContaining({
          id: created.body.id,
          clientId: "list-client",
          scopes: ["messages:write"],
          revoked: false,
          createdAt: expect.any(Number),
          expiresAt: expect.any(Number),
        }),
      ]);
      expect(response.body[0]).not.toHaveProperty("token");
      expect(response.body[0]).not.toHaveProperty("hash");

      const remote = await app.inject({
        method: "GET",
        url: "/api/tokens",
        remoteAddress: "203.0.113.10",
      });
      expect(remote.statusCode).toBe(403);
    });

    it("revokes a client token", async () => {
      const created = await request(app.server)
        .post("/api/tokens")
        .send({ clientId: "revoke-client", scopes: [] });

      const response = await request(app.server).delete(`/api/tokens/${created.body.id}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect((await request(app.server).get("/api/tokens")).body).toEqual([]);
    });
  });
});
