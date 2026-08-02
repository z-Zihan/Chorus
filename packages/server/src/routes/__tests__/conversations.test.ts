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

    const response = await request(app.server)
      .get(`/api/conversations/${created.body.id}/messages`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.any(Array));
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
    const messages = await request(app.server)
      .get(`/api/conversations/${created.body.id}/messages`);
    const agentMessages = messages.body.filter((message: { fromType: string }) =>
      message.fromType === "agent"
    );
    expect(agentMessages).toHaveLength(1);
    expect(agentMessages[0].fromId).toBe("test-agent");
  });

  it("broadcasts only when all agents are explicitly mentioned", async () => {
    const created = await request(app.server)
      .post("/api/conversations")
      .send({
        title: "Broadcast",
        type: "group",
        agentIds: ["test-agent", "second-agent"],
      });

    const response = await request(app.server)
      .post(`/api/conversations/${created.body.id}/messages`)
      .send({
        content: "hello everyone",
        mentionedAgents: ["test-agent", "second-agent"],
      });

    expect(response.status).toBe(201);
    const messages = await request(app.server)
      .get(`/api/conversations/${created.body.id}/messages`);
    const respondingAgentIds = messages.body
      .filter((message: { fromType: string }) => message.fromType === "agent")
      .map((message: { fromId: string }) => message.fromId)
      .sort();
    expect(respondingAgentIds).toEqual(["second-agent", "test-agent"]);
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
});
