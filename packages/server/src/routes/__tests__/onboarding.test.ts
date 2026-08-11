import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "./test-app";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("onboarding routes", () => {
  it("returns the current setup state", async () => {
    app = await buildTestApp();

    const response = await request(app.server).get("/api/onboarding/status");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ step: "bootstrapping", detections: [] });
  });

  it("returns recoverable domain failures as onboarding state", async () => {
    app = await buildTestApp();

    const response = await request(app.server)
      .post("/api/onboarding/select-agent")
      .send({ detectionId: "missing-detection" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      step: "error",
      detections: [],
      code: "CLI_NOT_FOUND",
      recoverable: true,
    });
  });

  it("rejects malformed Agent selections", async () => {
    app = await buildTestApp();

    const response = await request(app.server)
      .post("/api/onboarding/select-agent")
      .send({ detectionId: "" });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "INVALID_DETECTION" });
  });
});
