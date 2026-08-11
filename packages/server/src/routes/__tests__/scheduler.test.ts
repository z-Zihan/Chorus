import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./test-app";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("scheduled task routes", () => {
  it("creates, lists, disables, and deletes a scheduled task", async () => {
    app = await buildTestApp();

    const created = await request(app.server).post("/api/scheduler/tasks").send({
      agentId: "test-agent",
      cronExpression: "0 9 * * 1-5",
      prompt: "Summarize the latest work",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      agentId: "test-agent",
      cronExpression: "0 9 * * 1-5",
      prompt: "Summarize the latest work",
      enabled: true,
    });

    const listed = await request(app.server).get("/api/scheduler/tasks");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([expect.objectContaining({ id: created.body.id })]);

    const disabled = await request(app.server)
      .patch(`/api/scheduler/tasks/${created.body.id}`)
      .send({ enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);

    const deleted = await request(app.server).delete(`/api/scheduler/tasks/${created.body.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ ok: true });
    expect((await request(app.server).get("/api/scheduler/tasks")).body).toEqual([]);
  });

  it("rejects invalid schedules and missing Agents", async () => {
    app = await buildTestApp();

    const invalidCron = await request(app.server)
      .post("/api/scheduler/tasks")
      .send({ agentId: "test-agent", cronExpression: "not a cron", prompt: "Run" });
    expect(invalidCron.status).toBe(400);
    expect(invalidCron.body.error).toBe("Invalid cron expression");

    const missingAgent = await request(app.server)
      .post("/api/scheduler/tasks")
      .send({ agentId: "missing-agent", cronExpression: "0 9 * * *", prompt: "Run" });
    expect(missingAgent.status).toBe(404);
    expect(missingAgent.body.error).toBe("Agent not found");
  });
});
