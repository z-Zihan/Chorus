// Status route family (hub.ts GET /api/hub/status, POST /api/hub/connect,
// POST /api/hub/disconnect, GET /api/hub/contacts). The credential backend is
// pinned globally by vitest.setup.ts; these routes never touch the credential
// store, so no further isolation is needed here.

import type { HubConfig, HubConnectionState } from "@chorus/shared";
import Fastify from "fastify";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AgentRegistry } from "../../agent/registry.js";
import { createDatabase, type DatabaseContext } from "../../db/index.js";
import { Repository } from "../../db/repository.js";
import { ConnectionManager, type ConnectionInfo } from "../../hub/connection-manager.js";
import type { HubIdentity } from "../../hub/identity.js";
import { P2PListener } from "../../hub/p2p-listener.js";
import type { RelayClient } from "../../hub/relay-client.js";
import { registerHubRoutes } from "../hub.js";

interface RelayClientMock {
  state: HubConnectionState;
  disconnect: Mock;
}

interface StatusHarness {
  app: ReturnType<typeof Fastify>;
  registry: AgentRegistry;
  relayClient: RelayClientMock;
  connectionManager: ConnectionManager;
  connect: Mock;
}

async function startStatusHub(
  database: DatabaseContext,
  apps: Array<ReturnType<typeof Fastify>>,
  options: { relayClient?: RelayClientMock; connect?: Mock } = {},
): Promise<StatusHarness> {
  const repository = new Repository(database);
  const registry = new AgentRegistry(repository);
  await registry.initialize([]);
  const relayClient = options.relayClient ?? { state: "disconnected", disconnect: vi.fn() };
  const listener = new P2PListener();
  const connectionManager = new ConnectionManager(listener, relayClient as unknown as RelayClient);
  const hubConfig: HubConfig = {
    enabled: true,
    displayName: "Local Hub",
    relay: { url: "ws://relay.invalid" },
    p2p: { enabled: false, port: 3212, discovery: "none" },
  };
  const connect = options.connect ?? vi.fn();
  const app = Fastify({ logger: false });
  apps.push(app);
  registerHubRoutes(app, {
    identity: { hubId: "hub-local" } as HubIdentity,
    repository,
    relayClient: relayClient as unknown as RelayClient,
    registry,
    connectionManager,
    hubConfig,
    connect,
  });
  await app.ready();
  return { app, registry, relayClient, connectionManager, connect };
}

// Seed the registry the way inbound relay/p2p presence updates do, including
// the local hub itself to prove the status/contacts filters drop it.
function seedKnownHubs(registry: AgentRegistry): void {
  registry.setHubPresence("hub-local", "online", "local-public-key", "Local Hub");
  registry.setHubPresence("hub-p2p", "online", "p2p-public-key", "P2P Peer");
  registry.setHubPresence("hub-relay", "online", "relay-public-key", "Relay Peer");
  registry.setHubPresence("hub-idle", "offline", "idle-public-key", "Idle Peer");
}

const apps: Array<ReturnType<typeof Fastify>> = [];
let database: DatabaseContext;

beforeEach(() => {
  database = createDatabase(":memory:");
});

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  database.sqlite.close();
});

describe("GET /api/hub/status", () => {
  it("reports a disconnected relay and no peers when nothing is known", async () => {
    const hub = await startStatusHub(database, apps);

    const response = await request(hub.app.server).get("/api/hub/status");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ relayState: "disconnected", peers: [] });
  });

  it("maps each known hub to its active connection, excluding the local hub", async () => {
    const hub = await startStatusHub(database, apps);
    seedKnownHubs(hub.registry);
    hub.relayClient.state = "connected";
    const infos: Record<string, ConnectionInfo> = {
      "hub-p2p": { path: "p2p", p2pLatency: 42, relayLatency: 210 },
      "hub-relay": { path: "relay", p2pLatency: 7, relayLatency: 99 },
      "hub-idle": { path: "none", p2pLatency: null, relayLatency: null },
    };
    const getConnectionInfo = vi
      .spyOn(hub.connectionManager, "getConnectionInfo")
      .mockImplementation(
        (hubId: string) => infos[hubId] ?? { path: "none", p2pLatency: null, relayLatency: null },
      );

    const response = await request(hub.app.server).get("/api/hub/status");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      relayState: "connected",
      peers: [
        // path "p2p" reports p2pLatency even when a relay latency is known.
        { hubId: "hub-p2p", displayName: "P2P Peer", path: "p2p", latency: 42 },
        // any other path reports the relay latency instead.
        { hubId: "hub-relay", displayName: "Relay Peer", path: "relay", latency: 99 },
        { hubId: "hub-idle", displayName: "Idle Peer", path: "none", latency: null },
      ],
    });
    // The local hub is filtered out before its connection info is resolved.
    expect(getConnectionInfo).not.toHaveBeenCalledWith("hub-local");
  });
});

describe("POST /api/hub/connect", () => {
  it("awaits connect and reports the relay state it produced", async () => {
    const relayClient: RelayClientMock = { state: "disconnected", disconnect: vi.fn() };
    const connect = vi.fn().mockImplementation(async () => {
      relayClient.state = "connected";
    });
    const hub = await startStatusHub(database, apps, { relayClient, connect });

    const response = await request(hub.app.server).post("/api/hub/connect");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ state: "connected" });
    expect(hub.connect).toHaveBeenCalledTimes(1);
  });

  it("returns 502 with the relay state when connect rejects with an Error", async () => {
    const hub = await startStatusHub(database, apps, {
      connect: vi.fn().mockRejectedValue(new Error("relay unreachable")),
    });

    const response = await request(hub.app.server).post("/api/hub/connect");

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ state: "disconnected", error: "relay unreachable" });
  });

  it("stringifies non-Error rejection reasons", async () => {
    const hub = await startStatusHub(database, apps, {
      connect: vi.fn().mockRejectedValue("relay timeout"),
    });

    const response = await request(hub.app.server).post("/api/hub/connect");

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ state: "disconnected", error: "relay timeout" });
  });
});

describe("POST /api/hub/disconnect", () => {
  it("disconnects the relay client and reports its state", async () => {
    const hub = await startStatusHub(database, apps);
    hub.relayClient.state = "connected";
    // The real RelayClient.disconnect() synchronously clears its state.
    hub.relayClient.disconnect.mockImplementation(() => {
      hub.relayClient.state = "disconnected";
    });

    const response = await request(hub.app.server).post("/api/hub/disconnect");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ state: "disconnected" });
    expect(hub.relayClient.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/hub/contacts", () => {
  it("returns every known hub except the local one", async () => {
    const hub = await startStatusHub(database, apps);
    seedKnownHubs(hub.registry);

    const response = await request(hub.app.server).get("/api/hub/contacts");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { hubId: "hub-p2p", displayName: "P2P Peer", online: true, publicKey: "p2p-public-key" },
      {
        hubId: "hub-relay",
        displayName: "Relay Peer",
        online: true,
        publicKey: "relay-public-key",
      },
      {
        hubId: "hub-idle",
        displayName: "Idle Peer",
        online: false,
        publicKey: "idle-public-key",
      },
    ]);
  });

  it("returns an empty list when no hubs are known", async () => {
    const hub = await startStatusHub(database, apps);

    const response = await request(hub.app.server).get("/api/hub/contacts");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });
});
