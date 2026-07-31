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
});
