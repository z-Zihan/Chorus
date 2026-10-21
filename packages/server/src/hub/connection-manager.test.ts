import type { HubEnvelope } from "@chorus/shared";
import { describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "./connection-manager.js";
import type { P2PListener } from "./p2p-listener.js";
import type { RelayClient } from "./relay-client.js";

function makeP2PListener(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    isConnected: vi.fn(() => false),
    sendToHub: vi.fn(async () => false),
    getP2PLatency: vi.fn(() => null),
    ...overrides,
  } as unknown as P2PListener;
}

function makeRelayClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    state: "disconnected",
    sendEnvelope: vi.fn(),
    ...overrides,
  } as unknown as RelayClient;
}

function makeEnvelope(overrides: Partial<HubEnvelope> = {}): HubEnvelope {
  return {
    id: "envelope-1",
    from: "hub-a",
    to: "hub-b",
    type: "direct",
    timestamp: 1_000,
    nonce: "nonce",
    ciphertext: "ciphertext",
    signature: "signature",
    ...overrides,
  };
}

describe("ConnectionManager.getActivePath", () => {
  it("returns 'p2p' when the P2P peer is connected", () => {
    const p2pListener = makeP2PListener({ isConnected: vi.fn(() => true) });
    const relayClient = makeRelayClient({ state: "disconnected" });
    const manager = new ConnectionManager(p2pListener, relayClient);

    expect(manager.getActivePath("hub-b")).toBe("p2p");
  });

  it("returns 'relay' when P2P is unavailable but the Relay is connected", () => {
    const p2pListener = makeP2PListener({ isConnected: vi.fn(() => false) });
    const relayClient = makeRelayClient({ state: "connected" });
    const manager = new ConnectionManager(p2pListener, relayClient);

    expect(manager.getActivePath("hub-b")).toBe("relay");
  });

  it("returns 'none' when neither P2P nor Relay is available", () => {
    const p2pListener = makeP2PListener({ isConnected: vi.fn(() => false) });
    const relayClient = makeRelayClient({ state: "disconnected" });
    const manager = new ConnectionManager(p2pListener, relayClient);

    expect(manager.getActivePath("hub-b")).toBe("none");
  });

  it("prefers 'p2p' over 'relay' when both are available", () => {
    const p2pListener = makeP2PListener({ isConnected: vi.fn(() => true) });
    const relayClient = makeRelayClient({ state: "connected" });
    const manager = new ConnectionManager(p2pListener, relayClient);

    expect(manager.getActivePath("hub-b")).toBe("p2p");
  });
});

describe("ConnectionManager.isP2PAvailable", () => {
  it("passes through the P2P listener's isConnected result", () => {
    const isConnected = vi.fn(() => true);
    const p2pListener = makeP2PListener({ isConnected });
    const manager = new ConnectionManager(p2pListener, makeRelayClient());

    const result = manager.isP2PAvailable("hub-b");

    expect(result).toBe(true);
    expect(isConnected).toHaveBeenCalledWith("hub-b");
  });
});

describe("ConnectionManager.sendEnvelope", () => {
  it("returns true via P2P without touching the Relay when P2P delivery succeeds", async () => {
    const sendToHub = vi.fn(async () => true);
    const sendEnvelope = vi.fn();
    const p2pListener = makeP2PListener({ sendToHub });
    const relayClient = makeRelayClient({ state: "connected", sendEnvelope });
    const manager = new ConnectionManager(p2pListener, relayClient);
    const envelope = makeEnvelope();

    const result = await manager.sendEnvelope("hub-b", envelope);

    expect(result).toBe(true);
    expect(sendToHub).toHaveBeenCalledWith("hub-b", envelope);
    expect(sendEnvelope).not.toHaveBeenCalled();
  });

  it("falls back to the Relay and returns true when P2P delivery fails but the Relay is connected", async () => {
    const sendToHub = vi.fn(async () => false);
    const sendEnvelope = vi.fn();
    const p2pListener = makeP2PListener({ sendToHub });
    const relayClient = makeRelayClient({ state: "connected", sendEnvelope });
    const manager = new ConnectionManager(p2pListener, relayClient);
    const envelope = makeEnvelope();

    const result = await manager.sendEnvelope("hub-b", envelope);

    expect(result).toBe(true);
    expect(sendEnvelope).toHaveBeenCalledWith(envelope);
  });

  it("returns false when P2P delivery fails and the Relay is not connected", async () => {
    const sendToHub = vi.fn(async () => false);
    const sendEnvelope = vi.fn();
    const p2pListener = makeP2PListener({ sendToHub });
    const relayClient = makeRelayClient({ state: "disconnected", sendEnvelope });
    const manager = new ConnectionManager(p2pListener, relayClient);

    const result = await manager.sendEnvelope("hub-b", makeEnvelope());

    expect(result).toBe(false);
    expect(sendEnvelope).not.toHaveBeenCalled();
  });

  it("passes the envelope object through unchanged, whichever path is taken", async () => {
    const sendToHub = vi.fn(async (_hubId: string, _envelope: HubEnvelope) => true);
    const p2pListener = makeP2PListener({ sendToHub });
    const manager = new ConnectionManager(p2pListener, makeRelayClient());
    const envelope = makeEnvelope();

    await manager.sendEnvelope("hub-b", envelope);

    expect(sendToHub.mock.calls[0]?.[1]).toBe(envelope);
  });
});

describe("ConnectionManager.getConnectionInfo", () => {
  it("reports the active path and P2P latency, with relayLatency always null (current implementation)", () => {
    const p2pListener = makeP2PListener({
      isConnected: vi.fn(() => true),
      getP2PLatency: vi.fn(() => 42),
    });
    const relayClient = makeRelayClient({ state: "connected" });
    const manager = new ConnectionManager(p2pListener, relayClient);

    const info = manager.getConnectionInfo("hub-b");

    expect(info).toEqual({ path: "p2p", p2pLatency: 42, relayLatency: null });
  });

  it("reports relayLatency as null even when the path is 'relay' (not yet implemented)", () => {
    const p2pListener = makeP2PListener({ isConnected: vi.fn(() => false) });
    const relayClient = makeRelayClient({ state: "connected" });
    const manager = new ConnectionManager(p2pListener, relayClient);

    const info = manager.getConnectionInfo("hub-b");

    expect(info).toEqual({ path: "relay", p2pLatency: null, relayLatency: null });
  });
});
