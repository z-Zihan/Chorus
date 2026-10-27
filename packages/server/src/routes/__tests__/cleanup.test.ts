import type { FastifyInstance } from "fastify";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./test-app";

describe("cleanup routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  async function createConversation(title: string): Promise<string> {
    const response = await request(app.server)
      .post("/api/conversations")
      .send({ title, agentId: "test-agent" });
    return response.body.id as string;
  }

  it("rejects an empty ids array", async () => {
    const response = await request(app.server).delete("/api/conversations/batch").send({
      ids: [],
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid conversation IDs");
  });

  it("rejects blank string ids", async () => {
    const response = await request(app.server)
      .delete("/api/conversations/batch")
      .send({
        ids: ["   "],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid conversation IDs");
  });

  it("rejects batches over 500 ids", async () => {
    const ids = Array.from({ length: 501 }, (_, index) => `conversation-${index}`);
    const response = await request(app.server).delete("/api/conversations/batch").send({ ids });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid conversation IDs");
  });

  it("deletes the requested conversations and reports the actual count", async () => {
    const first = await createConversation("First");
    const second = await createConversation("Second");

    const response = await request(app.server)
      .delete("/api/conversations/batch")
      .send({ ids: [first, second] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ count: 2 });

    const remaining = await request(app.server).get("/api/conversations");
    expect(remaining.body).not.toContainEqual(expect.objectContaining({ id: first }));
    expect(remaining.body).not.toContainEqual(expect.objectContaining({ id: second }));
  });

  it("does not count ids that do not match an existing conversation", async () => {
    const existing = await createConversation("Only one real");

    const response = await request(app.server)
      .delete("/api/conversations/batch")
      .send({ ids: [existing, "does-not-exist"] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ count: 1 });
  });

  it("cancels scheduled tasks tied to a deleted conversation without throwing", async () => {
    const task = await request(app.server).post("/api/scheduler/tasks").send({
      agentId: "test-agent",
      cronExpression: "0 9 * * 1-5",
      prompt: "Summarize the latest work",
    });
    expect(task.status).toBe(201);
    const conversationId = task.body.conversationId as string;

    const response = await request(app.server)
      .delete("/api/conversations/batch")
      .send({ ids: [conversationId] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ count: 1 });

    const tasks = await request(app.server).get("/api/scheduler/tasks");
    expect(tasks.body).toEqual([]);
  });
});
