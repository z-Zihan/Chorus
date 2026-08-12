import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { TokenStore } from "../auth/token-store.js";
import { isWebSocketAuthorized } from "../ws/handler.js";
import { authMiddleware, isLoopbackAddress } from "./auth.js";

const enabledAuth = { enabled: true, tokens: {} };

describe("API authentication", () => {
  it.each(["127.0.0.1", "127.0.0.2", "::1", "::ffff:127.0.0.1", "localhost"])(
    "recognizes %s as loopback",
    (address) => {
      expect(isLoopbackAddress(address)).toBe(true);
    },
  );

  it("allows loopback requests without a token", async () => {
    const app = Fastify();
    app.addHook("onRequest", authMiddleware(enabledAuth, new TokenStore()));
    app.get("/api/private", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/api/private",
      remoteAddress: "127.0.0.1",
    });
    await app.close();
    expect(response.statusCode).toBe(200);
  });

  it("rejects non-loopback requests without a token and accepts a valid token", async () => {
    const app = Fastify();
    const store = new TokenStore();
    const created = store.create("remote", ["api:read"], 60_000);
    app.addHook("onRequest", authMiddleware(enabledAuth, store));
    app.get("/api/private", async () => ({ ok: true }));

    const unauthorized = await app.inject({
      method: "GET",
      url: "/api/private",
      remoteAddress: "203.0.113.10",
    });
    const authorized = await app.inject({
      method: "GET",
      url: "/api/private",
      remoteAddress: "203.0.113.10",
      headers: { authorization: `Bearer ${created.token}` },
    });
    await app.close();

    expect(unauthorized.statusCode).toBe(401);
    expect(authorized.statusCode).toBe(200);
  });

  it("enforces resource scopes for non-loopback client tokens", async () => {
    const app = Fastify();
    const store = new TokenStore();
    const allowed = store.create("agent-reader", ["agents:read"], 60_000);
    const denied = store.create("conversation-reader", ["conversations:read"], 60_000);
    app.addHook("onRequest", authMiddleware(enabledAuth, store));
    app.get("/api/agents", async () => ({ ok: true }));

    const forbidden = await app.inject({
      method: "GET",
      url: "/api/agents",
      remoteAddress: "203.0.113.10",
      headers: { authorization: `Bearer ${denied.token}` },
    });
    const authorized = await app.inject({
      method: "GET",
      url: "/api/agents",
      remoteAddress: "203.0.113.10",
      headers: { authorization: `Bearer ${allowed.token}` },
    });
    await app.close();

    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toEqual({ error: "Missing scope: agents:read" });
    expect(authorized.statusCode).toBe(200);
  });

  it("skips authentication when disabled", async () => {
    const app = Fastify();
    app.addHook("onRequest", authMiddleware({ enabled: false, tokens: {} }, new TokenStore()));
    app.get("/api/private", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/api/private",
      remoteAddress: "203.0.113.10",
    });
    await app.close();
    expect(response.statusCode).toBe(200);
  });
});

describe("WebSocket authentication", () => {
  it("requires ws:connect scope for a non-loopback connection", () => {
    const store = new TokenStore();
    const allowed = store.create("ws-client", ["ws:connect"], 60_000);
    const denied = store.create("http-client", ["agents:read"], 60_000);

    expect(
      isWebSocketAuthorized("203.0.113.10", `/ws?token=${allowed.token}`, enabledAuth, store),
    ).toBe(true);
    expect(
      isWebSocketAuthorized("203.0.113.10", `/ws?token=${denied.token}`, enabledAuth, store),
    ).toBe(false);
    expect(isWebSocketAuthorized("203.0.113.10", "/ws", enabledAuth, store)).toBe(false);
    expect(isWebSocketAuthorized("::1", "/ws", enabledAuth, store)).toBe(true);
  });
});
