import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { TokenStore } from "../../auth/token-store.js";
import { isWebSocketAuthorized } from "../../ws/handler.js";
import { registerTokenRoutes } from "../tokens.js";

const auth = { enabled: true, tokens: {} };

describe("WebSocket ticket API", () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("exchanges a scoped client token for a short-lived ws:connect ticket", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const store = new TokenStore();
    const source = store.create("desktop-web", ["ws:connect"], 60_000);
    registerTokenRoutes(app, store, auth);
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/tokens/ticket",
      remoteAddress: "203.0.113.10",
      headers: { authorization: `Bearer ${source.token}` },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      id: expect.stringMatching(/^tok_/),
      token: expect.stringMatching(/^tok_[^.]+\./),
      expiresInMs: 5 * 60 * 1_000,
    });
    expect(
      isWebSocketAuthorized(
        "203.0.113.10",
        `/ws?token=${response.json().token as string}`,
        auth,
        store,
      ),
    ).toBe(true);
  });

  it("rejects a source token without ws:connect scope", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    const store = new TokenStore();
    const source = store.create("reader", ["agents:read"], 60_000);
    registerTokenRoutes(app, store, auth);
    await app.ready();

    const response = await app.inject({
      method: "POST",
      url: "/api/tokens/ticket",
      remoteAddress: "203.0.113.10",
      headers: { authorization: `Bearer ${source.token}` },
    });

    expect(response.statusCode).toBe(403);
  });
});
