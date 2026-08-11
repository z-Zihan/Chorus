import Fastify from "fastify";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TrustStore } from "../../hub/trust-store.js";
import { registerTrustRoutes } from "../trust.js";

describe("trust routes", () => {
  let trustStore: TrustStore;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    trustStore = new TrustStore();
    app = Fastify({ logger: false });
    registerTrustRoutes(app, trustStore);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("does not expose the retired self-confirming pairing route", async () => {
    const pair = await request(app.server).post("/api/trust/pair").send({ hubId: "hub-api" });
    expect(pair.status).toBe(503);
    expect((await request(app.server).post("/api/trust/confirm").send({})).status).toBe(404);
  });

  it("retrieves, lists, blocks, and removes a mutually paired Hub", async () => {
    trustStore.completePairing("hub-api", {
      userId: "usr_api",
      userName: "API User",
      userPublicKey: "a".repeat(64),
    });

    expect((await request(app.server).get("/api/trust")).body).toHaveLength(1);
    expect((await request(app.server).get("/api/trust/hub-api")).body.hubId).toBe("hub-api");

    const blocked = await request(app.server).post("/api/trust/block").send({ hubId: "hub-api" });
    expect(blocked.body.hub.trustLevel).toBe("blocked");
    expect((await request(app.server).get("/api/trust")).body).toEqual([]);

    expect((await request(app.server).delete("/api/trust/hub-api")).status).toBe(200);
    expect((await request(app.server).get("/api/trust/hub-api")).status).toBe(404);
  });
});
