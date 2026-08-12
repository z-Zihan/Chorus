import type { FastifyInstance } from "fastify";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./test-app";

describe("standard protocol routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("exposes local Agents as A2A, MCP, and ACP descriptors", async () => {
    const published = await request(app.server)
      .patch("/api/agents/test-agent")
      .send({ visibility: "public" });
    expect(published.status).toBe(200);

    const standardCards = await app.inject({
      method: "GET",
      url: "/.well-known/agent-card.json",
    });
    const [compatibilityCards, tools, services] = await Promise.all([
      request(app.server).get("/api/.well-known/agent-card.json"),
      request(app.server).get("/api/mcp/tools"),
      request(app.server).get("/api/acp/services"),
    ]);

    expect(standardCards.statusCode).toBe(200);
    expect(compatibilityCards.status).toBe(200);
    expect(standardCards.json().map((card: { name: string }) => card.name)).toEqual(["Test Agent"]);
    expect(compatibilityCards.body.map((card: { name: string }) => card.name)).toEqual([
      "Test Agent",
      "Second Agent",
    ]);
    expect(standardCards.json()).toContainEqual(
      expect.objectContaining({
        name: "Test Agent",
        url: expect.stringMatching(/\/api\/agents\/test-agent$/),
      }),
    );
    expect(tools.status).toBe(200);
    expect(tools.body).toContainEqual(expect.objectContaining({ name: "test-agent" }));
    expect(services.status).toBe(200);
    expect(services.body).toContainEqual(
      expect.objectContaining({
        serviceId: "test-agent",
        serviceEndpoint: expect.stringMatching(/\/api\/conversations$/),
      }),
    );
  });
});
