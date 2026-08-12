import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerLogRoutes } from "../logs";

describe("diagnostics log routes", () => {
  let app = Fastify({ logger: false });

  beforeEach(async () => {
    app = Fastify({ logger: false });
    registerLogRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("accepts client batches, redacts secrets, and exposes them through the unified query", async () => {
    const id = `client-log-${crypto.randomUUID()}`;
    const accepted = await app.inject({
      method: "POST",
      url: "/api/logs/client",
      payload: {
        entries: [
          {
            id,
            timestamp: Date.now(),
            level: "error",
            message: "request failed token=top-secret",
            data: { authorization: "Bearer top-secret", safe: "visible" },
          },
        ],
      },
    });
    expect(accepted.statusCode).toBe(202);

    const response = await app.inject({
      method: "GET",
      url: "/api/logs?source=frontend&level=error&limit=2000",
    });
    expect(response.statusCode).toBe(200);
    const entry = response.json().find((item: { id?: string }) => item.id === id);
    expect(entry).toMatchObject({
      source: "frontend",
      level: "error",
      message: "request failed token=[REDACTED]",
      data: { authorization: "[REDACTED]", safe: "visible" },
    });
  });

  it("rejects oversized client batches", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/logs/client",
      payload: {
        entries: Array.from({ length: 101 }, (_, index) => ({
          timestamp: index,
          level: "info",
          message: "entry",
        })),
      },
    });
    expect(response.statusCode).toBe(400);
  });
});
