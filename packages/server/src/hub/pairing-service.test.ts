import { createHmac, randomUUID } from "node:crypto";
import { canonicalize, type HubEnvelope } from "@chorus/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseContext } from "../db/index.js";
import { Repository } from "../db/repository.js";
import { generateUserKeyPair } from "../identity/user-keys.js";
import { encryptPayload, generateHubKeypair, signEnvelope } from "./crypto.js";
import { PairingService } from "./pairing-service.js";
import { TrustStore } from "./trust-store.js";

interface TestSide {
  database: DatabaseContext;
  repository: Repository;
  trustStore: TrustStore;
  transport: TestTransport;
  service: PairingService;
  hubId: string;
  hubKey: { publicKey: string; secretKey: string };
}

class TestTransport {
  readonly state = "connected";
  readonly sent: HubEnvelope[] = [];

  sendEnvelope(envelope: HubEnvelope): void {
    this.sent.push(envelope);
  }

  take(): HubEnvelope {
    const envelope = this.sent.shift();
    if (!envelope) throw new Error("Expected a pairing envelope");
    return envelope;
  }
}

describe("PairingService", () => {
  const databases: DatabaseContext[] = [];

  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-08-11T12:00:00Z") }));

  afterEach(() => {
    vi.useRealTimers();
    for (const database of databases.splice(0)) database.sqlite.close();
  });

  async function side(name: string): Promise<TestSide> {
    const database = createDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const hubKey = await generateHubKeypair();
    const trustStore = new TrustStore(repository, hubKey.publicKey);
    const transport = new TestTransport();
    const service = new PairingService(
      { hubId: hubKey.publicKey, getSecretKey: async () => hubKey.secretKey },
      transport,
      trustStore,
      repository,
      () => name,
      generateUserKeyPair(),
    );
    return {
      database,
      repository,
      trustStore,
      transport,
      service,
      hubId: hubKey.publicKey,
      hubKey,
    };
  }

  async function reachApproval(a: TestSide, b: TestSide) {
    const created = a.service.createInvitation(b.hubId);
    const accepted = await b.service.acceptInvitation(created.pairingPackage);
    await a.service.onEnvelope(b.transport.take());
    await b.service.onEnvelope(a.transport.take());
    return { created, accepted };
  }

  function decodeInvitation(pairingPackage: string): {
    sessionId: string;
    secret: string;
    nonce: string;
  } {
    return JSON.parse(Buffer.from(pairingPackage, "base64url").toString("utf8")) as {
      sessionId: string;
      secret: string;
      nonce: string;
    };
  }

  function wireMac(secret: string, message: Record<string, unknown>): string {
    return createHmac("sha256", Buffer.from(secret, "base64url"))
      .update(canonicalize(message))
      .digest("base64url");
  }

  function pairingWire(
    invitation: { sessionId: string; secret: string; nonce: string },
    fromHubId: string,
    toHubId: string,
    kind: string,
  ): Record<string, unknown> {
    const unsigned = {
      version: 1,
      sessionId: invitation.sessionId,
      kind,
      nonce: invitation.nonce,
      fromHubId,
      toHubId,
    };
    return { ...unsigned, mac: wireMac(invitation.secret, unsigned) };
  }

  async function craftEnvelope(
    from: { hubId: string; secretKey: string },
    recipientHubId: string,
    wire: Record<string, unknown>,
  ): Promise<HubEnvelope> {
    const encrypted = await encryptPayload(wire, recipientHubId, from.secretKey);
    const unsigned = {
      id: randomUUID(),
      from: from.hubId,
      to: recipientHubId,
      type: "pairing" as const,
      timestamp: Date.now(),
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
    };
    return { ...unsigned, signature: await signEnvelope(unsigned, from.secretKey) };
  }

  it("requires two independent Hub proofs and explicit approval on both sides", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const { created, accepted } = await reachApproval(a, b);

    const aReady = a.service.get(created.session.sessionId);
    const bReady = b.service.get(accepted.sessionId);
    expect(aReady).toMatchObject({ status: "awaiting_approval", remoteUserName: "Bob" });
    expect(bReady).toMatchObject({ status: "awaiting_approval", remoteUserName: "Alice" });
    expect(aReady?.sas).toBe(bReady?.sas);
    expect(a.trustStore.isTrusted(b.hubId)).toBe(false);
    expect(b.trustStore.isTrusted(a.hubId)).toBe(false);

    await a.service.approve(created.session.sessionId);
    await b.service.onEnvelope(a.transport.take());
    expect(a.trustStore.isTrusted(b.hubId)).toBe(false);
    expect(b.trustStore.isTrusted(a.hubId)).toBe(false);

    await b.service.approve(accepted.sessionId);
    await a.service.onEnvelope(b.transport.take());
    expect(a.trustStore.get(b.hubId)).toMatchObject({ trustLevel: "trusted", userName: "Bob" });
    expect(b.trustStore.get(a.hubId)).toMatchObject({ trustLevel: "trusted", userName: "Alice" });
    expect(a.repository.listAgents({ includeRemote: true })).toEqual([]);
    expect(b.repository.listAgents({ includeRemote: true })).toEqual([]);
  });

  it("fails closed when the invitation secret is substituted", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const created = a.service.createInvitation(b.hubId);
    const invitation = JSON.parse(
      Buffer.from(created.pairingPackage, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    invitation.secret = Buffer.alloc(32, 7).toString("base64url");
    const substituted = Buffer.from(JSON.stringify(invitation), "utf8").toString("base64url");
    await b.service.acceptInvitation(substituted);

    await expect(a.service.onEnvelope(b.transport.take())).rejects.toThrow(
      "Pairing transcript verification failed",
    );
    expect(a.service.get(created.session.sessionId)?.status).toBe("failed");
    expect(a.trustStore.isTrusted(b.hubId)).toBe(false);
  });

  it("rejects wrong-target, replayed, expired, and cancelled sessions", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const c = await side("Carol");
    const created = a.service.createInvitation(b.hubId);
    await expect(c.service.acceptInvitation(created.pairingPackage)).rejects.toThrow(
      "targets another Hub",
    );
    const accepted = await b.service.acceptInvitation(created.pairingPackage);
    await expect(b.service.acceptInvitation(created.pairingPackage)).rejects.toThrow(
      "already been used",
    );
    const response = b.transport.take();
    await a.service.onEnvelope(response);
    await a.service.onEnvelope(response);
    expect(a.transport.sent).toHaveLength(1);
    await b.service.onEnvelope(a.transport.take());
    await a.service.cancel(created.session.sessionId);
    await b.service.onEnvelope(a.transport.take());
    expect(b.service.get(accepted.sessionId)?.status).toBe("cancelled");

    const expiring = a.service.createInvitation(c.hubId);
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await expect(c.service.acceptInvitation(expiring.pairingPackage)).rejects.toThrow("expired");
    expect(a.service.get(expiring.session.sessionId)?.status).toBe("expired");
  });

  it("prunes sessions long past expiry on the next invitation create/accept", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const c = await side("Carol");

    const stale = a.service.createInvitation(b.hubId);
    expect(a.service.list()).toHaveLength(1);

    vi.advanceTimersByTime(25 * 60 * 60 * 1000);

    // Pruning is lazy: it only runs on the next createInvitation/acceptInvitation call.
    const fresh = a.service.createInvitation(c.hubId);

    expect(a.service.get(stale.session.sessionId)).toBeUndefined();
    expect(a.service.list()).toHaveLength(1);
    expect(a.service.get(fresh.session.sessionId)).toMatchObject({ status: "waiting_peer" });

    const accepted = await c.service.acceptInvitation(fresh.pairingPackage);
    expect(accepted.status).toBe("verifying");
  });
  it("ignores envelopes that are not pairing or not addressed to this Hub", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const stranger = await generateHubKeypair();
    const created = a.service.createInvitation(b.hubId);
    const base = {
      id: randomUUID(),
      from: stranger.publicKey,
      to: a.hubId,
      type: "pairing" as const,
      timestamp: Date.now(),
      nonce: Buffer.alloc(24, 1).toString("base64"),
      ciphertext: "garbage",
      signature: "garbage",
    };

    await a.service.onEnvelope({ ...base, type: "direct" });
    await a.service.onEnvelope({ ...base, to: stranger.publicKey });

    expect(a.service.get(created.session.sessionId)).toMatchObject({ status: "waiting_peer" });
    expect(a.transport.sent).toHaveLength(0);
  });

  it("rejects malformed pairing envelopes without changing session state", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const stranger = await generateHubKeypair();
    const forger = await generateHubKeypair();
    const created = a.service.createInvitation(b.hubId);
    const sessionId = created.session.sessionId;
    const makeUnsigned = () => ({
      id: randomUUID(),
      from: stranger.publicKey,
      to: a.hubId,
      type: "pairing" as const,
      timestamp: Date.now(),
      nonce: Buffer.alloc(24, 2).toString("base64"),
      ciphertext: "garbage",
    });

    await expect(
      a.service.onEnvelope({ ...makeUnsigned(), from: "not-hex", signature: "garbage" }),
    ).rejects.toThrow("Invalid pairing sender Hub ID");
    const forged = {
      ...makeUnsigned(),
      signature: await signEnvelope(makeUnsigned(), forger.secretKey),
    };
    await expect(a.service.onEnvelope(forged)).rejects.toThrow(
      "Invalid pairing envelope signature",
    );

    const undecryptable = await craftEnvelope(
      { hubId: stranger.publicKey, secretKey: stranger.secretKey },
      a.hubId,
      { junk: true },
    );
    await expect(a.service.onEnvelope(undecryptable)).rejects.toThrow("Unknown pairing session");

    expect(a.service.get(sessionId)).toMatchObject({ status: "waiting_peer" });
    expect(a.transport.sent).toHaveLength(0);
  });

  it("silently swallows a replayed envelope id even when the payload differs", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const stranger = await generateHubKeypair();
    const created = a.service.createInvitation(b.hubId);
    const first = await craftEnvelope(
      { hubId: stranger.publicKey, secretKey: stranger.secretKey },
      a.hubId,
      { junk: 1 },
    );
    const replay = { ...first, ciphertext: "other" };

    await expect(a.service.onEnvelope(first)).rejects.toThrow("Unknown pairing session");
    await expect(a.service.onEnvelope(replay)).resolves.toBeUndefined();
    expect(a.service.get(created.session.sessionId)).toMatchObject({ status: "waiting_peer" });
    expect(a.transport.sent).toHaveLength(0);
  });

  it("treats unexpected pairing kinds as protocol errors without failing the session", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const created = a.service.createInvitation(b.hubId);
    const invitation = decodeInvitation(created.pairingPackage);
    const sender = { hubId: b.hubId, secretKey: b.hubKey.secretKey };

    const prematureApprove = await craftEnvelope(
      sender,
      a.hubId,
      pairingWire(invitation, b.hubId, a.hubId, "approve"),
    );
    await expect(a.service.onEnvelope(prematureApprove)).rejects.toThrow(
      "Unexpected approve pairing message",
    );

    const unknownKind = await craftEnvelope(
      sender,
      a.hubId,
      pairingWire(invitation, b.hubId, a.hubId, "bogus"),
    );
    await expect(a.service.onEnvelope(unknownKind)).rejects.toThrow(
      "Unexpected bogus pairing message",
    );

    expect(a.service.get(invitation.sessionId)).toMatchObject({ status: "waiting_peer" });
    expect(a.transport.sent).toHaveLength(0);
  });

  it("returns undefined for unknown sessions and rejects approve/cancel for them", async () => {
    const a = await side("Alice");
    expect(a.service.get("missing-session")).toBeUndefined();
    await expect(a.service.approve("missing-session")).rejects.toThrow("Pairing session not found");
    await expect(a.service.cancel("missing-session")).rejects.toThrow("Pairing session not found");
    expect(a.transport.sent).toHaveLength(0);
  });

  it("rejects approve and repeated cancel once a session is cancelled", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const { created } = await reachApproval(a, b);
    const sessionId = created.session.sessionId;

    const cancelled = await a.service.cancel(sessionId);
    expect(cancelled).toMatchObject({ status: "cancelled" });
    await expect(a.service.cancel(sessionId)).rejects.toThrow("Pairing session is cancelled");
    await expect(a.service.approve(sessionId)).rejects.toThrow("Pairing session is cancelled");
    expect(a.service.get(sessionId)).toMatchObject({ status: "cancelled" });
    expect(a.transport.sent).toHaveLength(1);
  });

  it("re-sends the approve envelope when approve is called twice before peer approval", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const { created, accepted } = await reachApproval(a, b);
    const aSessionId = created.session.sessionId;
    const bSessionId = accepted.sessionId;

    await a.service.approve(aSessionId);
    await a.service.approve(aSessionId);
    expect(a.transport.sent).toHaveLength(2);
    expect(a.service.get(aSessionId)).toMatchObject({
      status: "awaiting_approval",
      localApproved: true,
      peerApproved: false,
    });

    await b.service.onEnvelope(a.transport.take());
    expect(b.service.get(bSessionId)).toMatchObject({
      status: "awaiting_approval",
      peerApproved: true,
    });

    await b.service.onEnvelope(a.transport.take());
    expect(b.service.get(bSessionId)).toMatchObject({
      status: "awaiting_approval",
      peerApproved: true,
    });
    expect(b.transport.sent).toHaveLength(0);
  });

  it("ignores a replayed response envelope without a second state transition", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const created = a.service.createInvitation(b.hubId);
    await b.service.acceptInvitation(created.pairingPackage);
    const response = b.transport.take();

    await a.service.onEnvelope(response);
    expect(a.service.get(created.session.sessionId)).toMatchObject({
      status: "awaiting_approval",
    });
    expect(a.transport.sent).toHaveLength(1);

    await a.service.onEnvelope(response);
    expect(a.service.get(created.session.sessionId)).toMatchObject({
      status: "awaiting_approval",
    });
    expect(a.transport.sent).toHaveLength(1);
  });
});
