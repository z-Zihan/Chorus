import type { FastifyInstance } from "fastify";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./test-app";

describe("agent routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /api/agents returns an array", async () => {
    const response = await request(app.server).get("/api/agents");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.any(Array));
    expect(response.body).toContainEqual(expect.objectContaining({ id: "test-agent" }));
  });

  it("GET /api/agents/:id returns 404 for an unknown agent", async () => {
    const response = await request(app.server).get("/api/agents/unknown-agent");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Agent not found" });
  });

  it("creates Agents as private by default and allows an explicit visibility update", async () => {
    const created = await request(app.server).post("/api/agents").send({
      id: "private-by-default",
      name: "Private by default",
      type: "mock",
      config: {},
    });

    expect(created.status).toBe(201);
    expect(created.body.visibility).toBe("private");

    const updated = await request(app.server)
      .patch("/api/agents/private-by-default")
      .send({ visibility: "room" });

    expect(updated.status).toBe(200);
    expect(updated.body.visibility).toBe("room");
    expect((await request(app.server).get("/api/agents/private-by-default")).body.visibility).toBe(
      "room",
    );
  });
});
