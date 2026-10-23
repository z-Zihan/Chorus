import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type { HubEnvelope, P2PDiscoveredHub } from "@chorus/shared";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { generateHubKeypair, signEnvelope } from "./crypto.js";
import type { HubIdentity } from "./identity.js";
import { P2PListener } from "./p2p-listener.js";

/**
 * Real loopback integration tests: two independent P2PListener instances talk
 * to each other over real TCP/WebSocket sockets using real Ed25519 keys, no
 * mocking of `ws` or `./crypto.js`.
 *
 * Each simulated Hub needs its own keypair, but the production `HubIdentity`
 * backs onto a single-slot machine-wide credential store (see
 * `../credential-store.ts`: `getHubKey`/`setHubKey` take no identifying
 * argument), so two real `HubIdentity` instances in one process would fight
 * over the same storage slot. `P2PListener` only ever calls `identity.hubId`
 * and `identity.getSecretKey()`, so these tests use a minimal stand-in backed
 * by a real keypair from `generateHubKeypair()` instead of a full HubIdentity.
 */
function makeFakeIdentity(key: { publicKey: string; secretKey: string }): HubIdentity {
  return {
    hubId: key.publicKey,
    getPublicKey: () => key.publicKey,
    getFingerprint: () => key.publicKey.slice(0, 32),
    getSecretKey: async () => key.secretKey,
  } as unknown as HubIdentity;
}

interface Peer {
  identity: HubIdentity;
  publicKey: string;
  secretKey: string;
  port: number;
  listener: P2PListener;
}

/** Ask the OS for a currently-free TCP port, then release it immediately. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      const port = address && typeof address === "object" ? address.port : null;
      probe.close(() => {
        if (port) resolve(port);
        else reject(new Error("Unable to determine a free port"));
      });
    });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("waitFor: condition was not met in time");
    await delay(15);
  }
}

const activeListeners: P2PListener[] = [];

function track<T extends P2PListener>(listener: T): T {
  activeListeners.push(listener);
  return listener;
}

async function makePeer(): Promise<Peer> {
  const key = await generateHubKeypair();
  const identity = makeFakeIdentity(key);
  const listener = track(new P2PListener());
  const port = await freePort();
  await listener.start(port, identity);
  return { identity, publicKey: key.publicKey, secretKey: key.secretKey, port, listener };
}

function discoveredHub(peer: Peer, overrides: Partial<P2PDiscoveredHub> = {}): P2PDiscoveredHub {
  return {
    hubId: peer.identity.hubId,
    publicKey: peer.publicKey,
    displayName: peer.identity.hubId.slice(0, 8),
    host: "127.0.0.1",
    port: peer.port,
    txt: {},
    ...overrides,
  };
}

/** B learns A's public key, then A dials B; waits until both sides agree they're connected. */
async function connectPeers(a: Peer, b: Peer): Promise<void> {
  b.listener.setPeerPublicKey(a.identity.hubId, a.publicKey);
  await a.listener.connectToHub(discoveredHub(b));
  await waitFor(() => a.listener.isConnected(b.identity.hubId));
  await waitFor(() => b.listener.isConnected(a.identity.hubId));
}

function makeEnvelope(overrides: Partial<HubEnvelope> = {}): HubEnvelope {
  return {
    id: "envelope-1",
    from: "hub-a",
    to: "hub-b",
    type: "direct",
    timestamp: Date.now(),
    nonce: "nonce",
    ciphertext: "ciphertext",
    signature: "placeholder-signature",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(activeListeners.splice(0).map((listener) => listener.stop()));
});

describe("P2PListener.start", () => {
  it("binds the given port and returns it", async () => {
    const port = await freePort();
    const key = await generateHubKeypair();
    const listener = track(new P2PListener());

    const bound = await listener.start(port, makeFakeIdentity(key));

    expect(bound).toBe(port);
    expect(listener.listeningPort).toBe(port);
  });

  it("is idempotent: a second start() call returns the already-bound port, ignoring the new argument", async () => {
    const port = await freePort();
    const key = await generateHubKeypair();
    const listener = track(new P2PListener());
    await listener.start(port, makeFakeIdentity(key));

    const second = await listener.start(port + 1, makeFakeIdentity(key));

    expect(second).toBe(port);
    expect(listener.listeningPort).toBe(port);
  });

  it("retries the next port when the requested port is already occupied", async () => {
    const port = await freePort();
    const occupying = createServer();
    await new Promise<void>((resolve, reject) => {
      occupying.once("error", reject);
      occupying.listen(port, resolve);
    });

    try {
      const key = await generateHubKeypair();
      const listener = track(new P2PListener());

      const bound = await listener.start(port, makeFakeIdentity(key));

      expect(bound).toBe(port + 1);
      expect(listener.listeningPort).toBe(port + 1);
    } finally {
      await new Promise<void>((resolve) => occupying.close(() => resolve()));
    }
  });
});

describe("P2PListener handshake", () => {
  it("connects two listeners end to end: both sides authenticate and fire onPeerConnected", async () => {
    const a = await makePeer();
    const b = await makePeer();
    const aConnected: string[] = [];
    const bConnected: string[] = [];
    a.listener.onPeerConnected((hubId) => aConnected.push(hubId));
    b.listener.onPeerConnected((hubId) => bConnected.push(hubId));

    await connectPeers(a, b);

    expect(a.listener.isConnected(b.identity.hubId)).toBe(true);
    expect(b.listener.isConnected(a.identity.hubId)).toBe(true);
    expect(aConnected).toEqual([b.identity.hubId]);
    expect(bConnected).toEqual([a.identity.hubId]);
  });

  it("returns early without connecting when the discovered hub is the local identity", async () => {
    const a = await makePeer();

    await a.listener.connectToHub(discoveredHub(a));

    expect(a.listener.isConnected(a.identity.hubId)).toBe(false);
  });
});

describe("P2PListener.sendToHub / onMessage", () => {
  it("delivers a real Ed25519-signed envelope to the peer's onMessage listeners", async () => {
    const a = await makePeer();
    const b = await makePeer();
    await connectPeers(a, b);
    const received: HubEnvelope[] = [];
    b.listener.onMessage((_hubId, envelope) => received.push(envelope));
    const envelope = makeEnvelope({ from: a.identity.hubId, to: b.identity.hubId });

    const sent = await a.listener.sendToHub(b.identity.hubId, envelope);

    expect(sent).toBe(true);
    await waitFor(() => received.length === 1);
    expect(received[0]).toEqual(envelope);
  });

  it("returns false when sending to a hub that is not currently connected", async () => {
    const a = await makePeer();

    const sent = await a.listener.sendToHub("unknown-hub-id", makeEnvelope());

    expect(sent).toBe(false);
  });
});

describe("P2PListener message integrity", () => {
  it("rejects a tampered envelope: drops it, closes the socket, and fires the peer's onPeerDisconnected", async () => {
    const a = await makePeer();
    const b = await makePeer();
    await connectPeers(a, b);
    const received: HubEnvelope[] = [];
    const bDisconnected: string[] = [];
    b.listener.onMessage((_hubId, envelope) => received.push(envelope));
    b.listener.onPeerDisconnected((hubId) => bDisconnected.push(hubId));

    const envelope = makeEnvelope({ from: a.identity.hubId, to: b.identity.hubId });
    const signature = await signEnvelope(envelope, a.secretKey);
    const tamperedEnvelope = { ...envelope, ciphertext: "tampered-ciphertext" };
    const rawConnections = (a.listener as unknown as { connections: Map<string, WebSocket> })
      .connections;
    const rawSocket = rawConnections.get(b.identity.hubId);
    expect(rawSocket).toBeDefined();
    rawSocket?.send(JSON.stringify({ type: "p2p_message", envelope: tamperedEnvelope, signature }));

    await waitFor(() => bDisconnected.includes(a.identity.hubId));
    expect(received).toHaveLength(0);
    expect(b.listener.isConnected(a.identity.hubId)).toBe(false);
  });
});

describe("P2PListener health checks", () => {
  it("measures real round-trip latency via startHealthChecks, then stopHealthChecks clears the timer", async () => {
    const a = await makePeer();
    const b = await makePeer();
    await connectPeers(a, b);

    a.listener.startHealthChecks(50);

    await waitFor(() => typeof a.listener.getP2PLatency(b.identity.hubId) === "number");
    expect(a.listener.getP2PLatency(b.identity.hubId)).toBeGreaterThanOrEqual(0);

    expect(() => a.listener.stopHealthChecks()).not.toThrow();
  });

  it("getP2PLatency returns null for a hub that is not connected", async () => {
    const a = await makePeer();

    expect(a.listener.getP2PLatency("unknown-hub-id")).toBeNull();
  });
});

describe("P2PListener unauthorized registration", () => {
  it("closes a raw socket that registers with a hubId whose public key was never discovered", async () => {
    const a = await makePeer();
    const rogueSocket = new WebSocket(`ws://127.0.0.1:${a.port}`);

    const closeEvent = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      rogueSocket.on("open", () => {
        rogueSocket.send(
          JSON.stringify({ type: "p2p_register", hubId: "rogue-hub-id", nonce: "rogue-nonce" }),
        );
      });
      rogueSocket.on("close", (code, reason) => resolve({ code, reason: reason.toString() }));
      rogueSocket.on("error", reject);
    });

    expect(closeEvent.code).toBe(1008);
    expect(closeEvent.reason).toContain("not discovered");
  });
});

describe("P2PListener.stop", () => {
  it("closes connections, clears listening state, and is idempotent", async () => {
    const a = await makePeer();
    const b = await makePeer();
    await connectPeers(a, b);

    await a.listener.stop();

    expect(a.listener.listeningPort).toBeUndefined();
    expect(a.listener.isConnected(b.identity.hubId)).toBe(false);
    await waitFor(() => !b.listener.isConnected(a.identity.hubId));
    await expect(a.listener.stop()).resolves.toBeUndefined();
  });
});

describe("P2PListener.connectToHub against an unreachable peer", () => {
  it("rejects without corrupting listener state; the listener can still connect to a real peer afterward", async () => {
    const a = await makePeer();
    const deadPort = await freePort();
    const deadHub: P2PDiscoveredHub = {
      hubId: "dead-hub-id",
      publicKey: "dead-hub-public-key",
      displayName: "dead-hub",
      host: "127.0.0.1",
      port: deadPort,
      txt: {},
    };

    await expect(a.listener.connectToHub(deadHub)).rejects.toThrow();
    expect(a.listener.isConnected("dead-hub-id")).toBe(false);

    const b = await makePeer();
    await connectPeers(a, b);
    expect(a.listener.isConnected(b.identity.hubId)).toBe(true);
  });
});
