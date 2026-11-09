import type { HubConfig, P2PDiscoveredHub } from "@chorus/shared";
import Fastify from "fastify";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AgentRegistry } from "../../agent/registry.js";
import { createDatabase, type DatabaseContext } from "../../db/index.js";
import { Repository } from "../../db/repository.js";
import { ConnectionManager } from "../../hub/connection-manager.js";
import type { HubIdentity } from "../../hub/identity.js";
import { P2PListener } from "../../hub/p2p-listener.js";
import type { RelayClient } from "../../hub/relay-client.js";
import { registerHubRoutes } from "../hub.js";

const HUB_CONFIG_SETTING_KEY = "hub.config";
const P2P_DISMISSED_SETTING_KEY = "hub.p2p.dismissed";
const P2P_APPROVED_SETTING_KEY = "hub.p2p.approved";

function discoveredHub(overrides: Partial<P2PDiscoveredHub> = {}): P2PDiscoveredHub {
  return {
    hubId: "hub-peer",
    publicKey: "peer-public-key",
    displayName: "Peer Hub",
    host: "192.0.2.10",
    port: 3213,
    txt: {},
    ...overrides,
  };
}

interface HubHarness {
  app: ReturnType<typeof Fastify>;
  repository: Repository;
  listener: P2PListener;
  connectToHub: Mock;
  setPeerPublicKey: Mock;
}

async function startHub(
  database: DatabaseContext,
  apps: Array<ReturnType<typeof Fastify>>,
  options: { p2pEnabled?: boolean } = {},
): Promise<HubHarness> {
  const repository = new Repository(database);
  const registry = new AgentRegistry(repository);
  await registry.initialize([]);
  const relayClient = { state: "disconnected" } as unknown as RelayClient;
  const listener = new P2PListener();
  const connectionManager = new ConnectionManager(listener, relayClient);
  const hubConfig: HubConfig = {
    enabled: true,
    displayName: "Local Hub",
    relay: { url: "ws://relay.invalid" },
    p2p: { enabled: options.p2pEnabled ?? true, port: 3212, discovery: "none" },
  };
  // registerHubRoutes binds these methods as the "real" P2P dial path before
  // wrapping the instance properties, so spying before registration makes every
  // approved dial observable while unapproved discovery stays passive (no real
  // sockets are opened and no started listener identity is required).
  const connectToHub = vi.spyOn(listener, "connectToHub").mockResolvedValue(undefined);
  const setPeerPublicKey = vi.spyOn(listener, "setPeerPublicKey");
  const app = Fastify({ logger: false });
  apps.push(app);
  registerHubRoutes(app, {
    identity: { hubId: "hub-local" } as HubIdentity,
    repository,
    relayClient,
    registry,
    connectionManager,
    hubConfig,
    connect: vi.fn(),
  });
  await app.ready();
  return { app, repository, listener, connectToHub, setPeerPublicKey };
}

describe("Hub config lifecycle", () => {
  let database: DatabaseContext;
  const apps: Array<ReturnType<typeof Fastify>> = [];

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    database.sqlite.close();
  });

  it("returns the active config together with the local hub identity", async () => {
    const hub = await startHub(database, apps);

    const response = await request(hub.app.server).get("/api/hub/config");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      displayName: "Local Hub",
      relayUrl: "ws://relay.invalid",
      p2pEnabled: true,
      p2pPort: 3212,
      hubId: "hub-local",
    });
  });

  it("rejects a missing, blank or non-string displayName without persisting", async () => {
    const hub = await startHub(database, apps);

    for (const displayName of ["", "   ", 42, null]) {
      const response = await request(hub.app.server).patch("/api/hub/config").send({ displayName });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "displayName must be a non-empty string" });
    }

    const config = await request(hub.app.server).get("/api/hub/config");
    expect(config.body.displayName).toBe("Local Hub");
    expect(hub.repository.getSetting(HUB_CONFIG_SETTING_KEY)).toBeUndefined();
  });

  it("applies a trimmed displayName and renames the local protocol user", async () => {
    const hub = await startHub(database, apps);
    await hub.repository.getOrCreateLocalUser("Local Hub");

    const response = await request(hub.app.server)
      .patch("/api/hub/config")
      .send({ displayName: "  Studio Hub  " });

    expect(response.status).toBe(200);
    expect(response.body.displayName).toBe("Studio Hub");
    expect((await request(hub.app.server).get("/api/hub/config")).body.displayName).toBe(
      "Studio Hub",
    );
    expect(hub.repository.getUser("usr_local")?.name).toBe("Studio Hub");
    expect(JSON.parse(hub.repository.getSetting(HUB_CONFIG_SETTING_KEY) ?? "{}")).toMatchObject({
      displayName: "Studio Hub",
    });
  });

  it("rejects a non-string relayUrl but accepts a blank one to clear it", async () => {
    const hub = await startHub(database, apps);

    const invalid = await request(hub.app.server).patch("/api/hub/config").send({ relayUrl: 123 });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ error: "relayUrl must be a string" });

    const cleared = await request(hub.app.server).patch("/api/hub/config").send({ relayUrl: "  " });
    expect(cleared.status).toBe(200);
    expect(cleared.body.relayUrl).toBe("");

    const updated = await request(hub.app.server)
      .patch("/api/hub/config")
      .send({ relayUrl: "wss://relay.example" });
    expect(updated.status).toBe(200);
    expect((await request(hub.app.server).get("/api/hub/config")).body.relayUrl).toBe(
      "wss://relay.example",
    );
  });

  it("rejects a non-boolean p2pEnabled", async () => {
    const hub = await startHub(database, apps);

    for (const p2pEnabled of ["true", 1, null]) {
      const response = await request(hub.app.server).patch("/api/hub/config").send({ p2pEnabled });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "p2pEnabled must be a boolean" });
    }

    const response = await request(hub.app.server).patch("/api/hub/config").send({
      p2pEnabled: false,
    });
    expect(response.status).toBe(200);
    expect(response.body.p2pEnabled).toBe(false);
  });

  it("rejects out-of-range or non-integer p2pPort values and accepts the boundaries", async () => {
    const hub = await startHub(database, apps);

    for (const p2pPort of [0, 65536, 1.5, "80", null]) {
      const response = await request(hub.app.server).patch("/api/hub/config").send({ p2pPort });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "p2pPort must be an integer between 1 and 65535" });
    }

    for (const p2pPort of [1, 65535]) {
      const response = await request(hub.app.server).patch("/api/hub/config").send({ p2pPort });
      expect(response.status).toBe(200);
      expect(response.body.p2pPort).toBe(p2pPort);
    }
  });

  it("persists config changes and reloads them on a fresh registration", async () => {
    const first = await startHub(database, apps);
    const response = await request(first.app.server).patch("/api/hub/config").send({
      displayName: "Restarted Hub",
      relayUrl: "wss://relay2.example",
      p2pEnabled: false,
      p2pPort: 4000,
    });
    expect(response.status).toBe(200);

    // The second registration gets a brand-new default hubConfig, so any value
    // it returns must have come from the repository setting.
    const second = await startHub(database, apps);
    expect((await request(second.app.server).get("/api/hub/config")).body).toEqual({
      displayName: "Restarted Hub",
      relayUrl: "wss://relay2.example",
      p2pEnabled: false,
      p2pPort: 4000,
      hubId: "hub-local",
    });
  });
});

describe("P2P pairing", () => {
  let database: DatabaseContext;
  const apps: Array<ReturnType<typeof Fastify>> = [];

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
    database.sqlite.close();
  });

  it("validates hubId before the P2P-enabled check", async () => {
    const hub = await startHub(database, apps, { p2pEnabled: false });

    for (const body of [{}, { hubId: "   " }, { hubId: 42 }]) {
      const response = await request(hub.app.server).post("/api/hub/p2p/connect").send(body);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "hubId must be a non-empty string" });
    }

    const disabled = await request(hub.app.server)
      .post("/api/hub/p2p/connect")
      .send({ hubId: "hub-peer" });
    expect(disabled.status).toBe(409);
    expect(disabled.body).toEqual({ error: "P2P is disabled" });
  });

  it("returns 404 when connecting to an undiscovered hub", async () => {
    const hub = await startHub(database, apps);

    const response = await request(hub.app.server)
      .post("/api/hub/p2p/connect")
      .send({ hubId: "hub-unknown" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "P2P device not found" });
    expect(hub.connectToHub).not.toHaveBeenCalled();
  });

  it("keeps unapproved discovery passive: cached for listing but never dialed", async () => {
    const hub = await startHub(database, apps);

    // The replaced listener.connectToHub is the discovery entry point the
    // bootstrap mDNS advertiser would call.
    await hub.listener.connectToHub(discoveredHub());

    expect(hub.connectToHub).not.toHaveBeenCalled();
    expect(hub.setPeerPublicKey).not.toHaveBeenCalled();
    expect((await request(hub.app.server).get("/api/hub/p2p/discovered")).body).toEqual([
      { hubId: "hub-peer", displayName: "Peer Hub" },
    ]);
  });

  it("connect approves a discovered peer, dials it and persists the approval", async () => {
    const hub = await startHub(database, apps);
    const peer = discoveredHub();
    await hub.listener.connectToHub(peer);

    const response = await request(hub.app.server)
      .post("/api/hub/p2p/connect")
      .send({ hubId: peer.hubId });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(hub.setPeerPublicKey).toHaveBeenCalledWith(peer.hubId, peer.publicKey);
    expect(hub.connectToHub).toHaveBeenCalledWith(peer);
    expect(hub.repository.getSetting(P2P_APPROVED_SETTING_KEY)).toBe(JSON.stringify(["hub-peer"]));

    // Once approved, a re-announced discovery dials immediately instead of
    // staying passive.
    hub.connectToHub.mockClear();
    await hub.listener.connectToHub(peer);
    expect(hub.connectToHub).toHaveBeenCalledWith(peer);
  });

  it("rolls back the approval and keeps the peer listed when the dial fails", async () => {
    const hub = await startHub(database, apps);
    const peer = discoveredHub();
    await hub.listener.connectToHub(peer);
    hub.connectToHub.mockRejectedValueOnce(new Error("P2P dial failed"));

    const response = await request(hub.app.server)
      .post("/api/hub/p2p/connect")
      .send({ hubId: peer.hubId });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: "P2P dial failed" });
    expect(hub.repository.getSetting(P2P_APPROVED_SETTING_KEY)).toBeUndefined();

    // The in-memory approval was rolled back too: re-announced discovery stays passive.
    hub.connectToHub.mockClear();
    await hub.listener.connectToHub(peer);
    expect(hub.connectToHub).not.toHaveBeenCalled();
    expect((await request(hub.app.server).get("/api/hub/p2p/discovered")).body).toEqual([
      { hubId: "hub-peer", displayName: "Peer Hub" },
    ]);
  });

  it("validates dismiss hubId", async () => {
    const hub = await startHub(database, apps);

    for (const body of [{}, { hubId: "" }]) {
      const response = await request(hub.app.server).post("/api/hub/p2p/dismiss").send(body);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "hubId must be a non-empty string" });
    }
  });

  it("dismiss hides a discovered peer and revokes its approval", async () => {
    const hub = await startHub(database, apps);
    const peer = discoveredHub();
    await hub.listener.connectToHub(peer);
    await request(hub.app.server).post("/api/hub/p2p/connect").send({ hubId: peer.hubId });
    expect(hub.repository.getSetting(P2P_APPROVED_SETTING_KEY)).toBe(JSON.stringify(["hub-peer"]));

    const response = await request(hub.app.server)
      .post("/api/hub/p2p/dismiss")
      .send({ hubId: peer.hubId });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect((await request(hub.app.server).get("/api/hub/p2p/discovered")).body).toEqual([]);
    expect(hub.repository.getSetting(P2P_APPROVED_SETTING_KEY)).toBe(JSON.stringify([]));
    expect(hub.repository.getSetting(P2P_DISMISSED_SETTING_KEY)).toBe(JSON.stringify(["hub-peer"]));
  });

  it("re-dials approved peers automatically after a restart", async () => {
    const first = await startHub(database, apps);
    const peer = discoveredHub();
    await first.listener.connectToHub(peer);
    const approved = await request(first.app.server)
      .post("/api/hub/p2p/connect")
      .send({ hubId: peer.hubId });
    expect(approved.status).toBe(200);

    // Restart: same repository (persisted approvals) but a brand-new listener.
    const second = await startHub(database, apps);
    await second.listener.connectToHub(peer);

    expect(second.setPeerPublicKey).toHaveBeenCalledWith(peer.hubId, peer.publicKey);
    expect(second.connectToHub).toHaveBeenCalledWith(peer);
  });

  it("keeps dismissed peers passive after a restart", async () => {
    const first = await startHub(database, apps);
    const peer = discoveredHub();
    await first.listener.connectToHub(peer);
    await request(first.app.server).post("/api/hub/p2p/dismiss").send({ hubId: peer.hubId });

    const second = await startHub(database, apps);
    await second.listener.connectToHub(peer);

    expect(second.connectToHub).not.toHaveBeenCalled();
    expect(second.setPeerPublicKey).not.toHaveBeenCalled();
    expect((await request(second.app.server).get("/api/hub/p2p/discovered")).body).toEqual([]);
  });

  it("reports P2P status with discovered and connected peers", async () => {
    const hub = await startHub(database, apps);
    const peer = discoveredHub();
    await hub.listener.connectToHub(peer);

    const idle = await request(hub.app.server).get("/api/hub/p2p/status");
    expect(idle.body).toEqual({
      enabled: true,
      port: 3212,
      connected: [],
      discovered: [{ hubId: "hub-peer", displayName: "Peer Hub" }],
    });

    // A peer with an authenticated socket moves from discovered to connected.
    vi.spyOn(hub.listener, "isConnected").mockReturnValue(true);
    const active = await request(hub.app.server).get("/api/hub/p2p/status");
    expect(active.body.connected).toEqual([
      { hubId: "hub-peer", displayName: "Peer Hub", latency: null, status: "connected" },
    ]);
    expect(active.body.discovered).toEqual([]);
  });
});
