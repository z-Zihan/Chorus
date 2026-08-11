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
    const [cards, tools, services] = await Promise.all([
      request(app.server).get("/api/.well-known/agent-card.json"),
      request(app.server).get("/api/mcp/tools"),
      request(app.server).get("/api/acp/services"),
    ]);

    expect(cards.status).toBe(200);
    expect(cards.body).toContainEqual(
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
