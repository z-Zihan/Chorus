import Fastify from "fastify";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TrustStore } from "../../hub/trust-store.js";
import { registerTrustRoutes } from "../trust.js";

describe("trust routes", () => {
  const trustStore = new TrustStore();
  const app = Fastify({ logger: false });

  beforeEach(async () => {
    registerTrustRoutes(app, trustStore);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("pairs, retrieves, lists, blocks, and removes a Hub", async () => {
    const pair = await request(app.server).post("/api/trust/pair").send({ hubId: "hub-api" });
    expect(pair.status).toBe(200);
    expect(pair.body.code).toMatch(/^\d{6}$/);

    const confirm = await request(app.server)
      .post("/api/trust/confirm")
      .send({ hubId: "hub-api", code: pair.body.code });
    expect(confirm.status).toBe(200);
    expect(confirm.body.hub.trustLevel).toBe("trusted");

    expect((await request(app.server).get("/api/trust")).body).toHaveLength(1);
    expect((await request(app.server).get("/api/trust/hub-api")).body.hubId).toBe("hub-api");

    const blocked = await request(app.server).post("/api/trust/block").send({ hubId: "hub-api" });
    expect(blocked.body.hub.trustLevel).toBe("blocked");
    expect((await request(app.server).get("/api/trust")).body).toEqual([]);

    expect((await request(app.server).delete("/api/trust/hub-api")).status).toBe(200);
    expect((await request(app.server).get("/api/trust/hub-api")).status).toBe(404);
  });
});
