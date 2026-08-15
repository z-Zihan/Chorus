import type { FastifyInstance } from "fastify";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./test-app";

describe("conversation routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /api/conversations returns an array", async () => {
    const response = await request(app.server).get("/api/conversations");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.any(Array));
  });

  it("POST /api/conversations creates a conversation", async () => {
    const response = await request(app.server)
      .post("/api/conversations")
      .send({ title: "Test conversation", agentId: "test-agent" });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      title: "Test conversation",
      type: "dm",
      a2aMode: "mention",
      agentIds: ["test-agent"],
    });
    expect(response.body.id).toEqual(expect.any(String));
  });

  it("DELETE /api/conversations/:id deletes a conversation", async () => {
    const created = await request(app.server)
      .post("/api/conversations")
      .send({ title: "Delete me", agentId: "test-agent" });

    const response = await request(app.server).delete(`/api/conversations/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("GET /api/conversations/:id/messages returns an array", async () => {
    const created = await request(app.server)
      .post("/api/conversations")
      .send({ title: "Messages", agentId: "test-agent" });

    const response = await request(app.server).get(
      `/api/conversations/${created.body.id}/messages`,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.any(Array));
  });

  it("exports conversations with non-ASCII titles using a valid encoded filename", async () => {
    const created = await request(app.server)
      .post("/api/conversations")
      .send({ title: "中文 会话", agentId: "test-agent" });

    const response = await request(app.server).get(
      `/api/conversations/${created.body.id}/export?format=markdown`,
    );

    expect(response.status).toBe(200);
    expect(response.headers["content-disposition"]).toBe(
      "attachment; filename=\"conversation.md\"; filename*=UTF-8''%E4%B8%AD%E6%96%87-%E4%BC%9A%E8%AF%9D.md",
    );
    expect(response.text).toContain("# 中文 会话");
  });

  it("routes a group message without mentions only to the first online agent", async () => {
    const created = await request(app.server)
      .post("/api/conversations")
      .send({
        title: "Routing",
        type: "group",
        agentIds: ["test-agent", "second-agent"],
      });

    const response = await request(app.server)
      .post(`/api/conversations/${created.body.id}/messages`)
      .send({ content: "hello" });

    expect(response.status).toBe(201);
    const messages = await request(app.server).get(
      `/api/conversations/${created.body.id}/messages`,
    );
    const agentMessages = messages.body.filter(
      (message: { fromType: string }) => message.fromType === "agent",
    );
    expect(agentMessages).toHaveLength(1);
    expect(agentMessages[0].fromId).toBe("test-agent");
  });

  it("routes to explicitly selected agent, not @mentions (A2A hints)", async () => {
    const created = await request(app.server)
      .post("/api/conversations")
      .send({
        title: "Mention routing",
        type: "group",
        agentIds: ["test-agent", "second-agent"],
      });

    // @mention second-agent but explicitly route to test-agent
    const response = await request(app.server)
      .post(`/api/conversations/${created.body.id}/messages`)
      .send({
        content: "hey @second-agent can you help?",
        agentId: "test-agent",
        mentionedAgents: ["second-agent"],
      });

    expect(response.status).toBe(201);
    const messages = await request(app.server).get(
      `/api/conversations/${created.body.id}/messages`,
    );
    const respondingAgentIds = messages.body
      .filter((message: { fromType: string }) => message.fromType === "agent")
      .map((message: { fromId: string }) => message.fromId)
      .sort();
    // Only test-agent should respond — @mention is an A2A hint, not a routing target
    expect(respondingAgentIds).toEqual(["test-agent"]);
  });

  it("gets and updates the per-conversation A2A permission", async () => {
    const created = await request(app.server)
      .post("/api/conversations")
      .send({ title: "Permissions", agentId: "test-agent" });
    const path = `/api/conversations/${created.body.id}/a2a-permission`;

    const initial = await request(app.server).get(path);
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual({ mode: "auto" });

    const updated = await request(app.server).patch(path).send({ mode: "confirm" });
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual({ mode: "confirm" });

    const persisted = await request(app.server).get(path);
    expect(persisted.body).toEqual({ mode: "confirm" });
  });

  it("rejects an invalid A2A permission", async () => {
    const created = await request(app.server)
      .post("/api/conversations")
      .send({ title: "Permissions", agentId: "test-agent" });

    const response = await request(app.server)
      .patch(`/api/conversations/${created.body.id}/a2a-permission`)
      .send({ mode: "sometimes" });

    expect(response.status).toBe(400);
  });

  it("gets and persists the global A2A collaboration limits", async () => {
    const initial = await request(app.server).get("/api/a2a/settings");
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual({ maxRounds: 12, callTimeoutMinutes: 5 });

    const updated = await request(app.server)
      .patch("/api/a2a/settings")
      .send({ maxRounds: 24, callTimeoutMinutes: 8 });
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual({ maxRounds: 24, callTimeoutMinutes: 8 });

    const persisted = await request(app.server).get("/api/a2a/settings");
    expect(persisted.body).toEqual({ maxRounds: 24, callTimeoutMinutes: 8 });
  });

  it("keeps PATCH compatible with clients that only update the round limit", async () => {
    const response = await request(app.server).patch("/api/a2a/settings").send({ maxRounds: 18 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ maxRounds: 18, callTimeoutMinutes: 5 });
  });

  it.each([0, 51, 1.5, "12"])("rejects invalid A2A max rounds: %s", async (maxRounds) => {
    const response = await request(app.server).patch("/api/a2a/settings").send({ maxRounds });

    expect(response.status).toBe(400);
  });

  it.each([0, 31, 1.5, "5"])(
    "rejects invalid A2A call timeout minutes: %s",
    async (callTimeoutMinutes) => {
      const response = await request(app.server)
        .patch("/api/a2a/settings")
        .send({ callTimeoutMinutes });

      expect(response.status).toBe(400);
    },
  );

  it("updates and persists the conversation A2A mode", async () => {
    const created = await request(app.server)
      .post("/api/conversations")
      .send({ title: "A2A mode", agentId: "test-agent" });
    const path = `/api/conversations/${created.body.id}/a2a-mode`;

    const updated = await request(app.server).patch(path).send({ mode: "call" });
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual({ mode: "call" });

    const conversations = await request(app.server).get("/api/conversations");
    expect(conversations.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.body.id, a2aMode: "call" })]),
    );
  });

  it("rejects an invalid conversation A2A mode", async () => {
    const created = await request(app.server)
      .post("/api/conversations")
      .send({ title: "A2A mode", agentId: "test-agent" });

    const response = await request(app.server)
      .patch(`/api/conversations/${created.body.id}/a2a-mode`)
      .send({ mode: "sometimes" });

    expect(response.status).toBe(400);
  });

  it("forwards agent @mentions in mention mode", async () => {
    const created = await request(app.server)
      .post("/api/conversations")
      .send({
        title: "Mention mode",
        type: "group",
        agentIds: ["test-agent", "second-agent"],
      });

    const response = await request(app.server)
      .post(`/api/conversations/${created.body.id}/messages`)
      .send({ content: "request\n@Second Agent please continue" });

    expect(response.status).toBe(201);
    const messages = await request(app.server).get(
      `/api/conversations/${created.body.id}/messages`,
    );
    const respondingAgentIds = messages.body
      .filter((message: { fromType: string }) => message.fromType === "agent")
      .map((message: { fromId: string }) => message.fromId);
    expect(respondingAgentIds).toEqual(["test-agent", "test-agent", "second-agent"]);
    const initialReply = messages.body.find(
      (message: { fromType: string; toType?: string }) =>
        message.fromType === "agent" && message.toType === "user",
    );
    expect(initialReply.content).toContain("You are in a group chat with: [Second Agent]");
  });

  it("does not forward agent @mentions in off mode", async () => {
    const created = await request(app.server)
      .post("/api/conversations")
      .send({
        title: "Off mode",
        type: "group",
        agentIds: ["test-agent", "second-agent"],
      });
    await request(app.server)
      .patch(`/api/conversations/${created.body.id}/a2a-mode`)
      .send({ mode: "off" });

    const response = await request(app.server)
      .post(`/api/conversations/${created.body.id}/messages`)
      .send({ content: "request\n@Second Agent please continue" });

    expect(response.status).toBe(201);
    const messages = await request(app.server).get(
      `/api/conversations/${created.body.id}/messages`,
    );
    const respondingAgentIds = messages.body
      .filter((message: { fromType: string }) => message.fromType === "agent")
      .map((message: { fromId: string }) => message.fromId);
    expect(respondingAgentIds).toEqual(["test-agent"]);
    expect(messages.body.at(-1).content).not.toContain("You are in a group chat with:");
  });
});
