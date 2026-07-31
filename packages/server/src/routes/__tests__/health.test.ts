import type { FastifyInstance } from "fastify";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./test-app";

describe("health routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /api/health returns a healthy response", async () => {
    const response = await request(app.server).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true });
  });
});
