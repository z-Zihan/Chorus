import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { canonicalize, type HubEnvelope } from "@chorus/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseContext } from "../db/index.js";
import { Repository } from "../db/repository.js";
import {
  deriveUserId,
  generateUserKeyPair,
  signData as signUserData,
} from "../identity/user-keys.js";
import {
  decryptPayload,
  encryptPayload,
  generateHubKeypair,
  signEnvelope,
  verifySignature,
} from "./crypto.js";
import { PairingService } from "./pairing-service.js";
import { TrustStore } from "./trust-store.js";

interface TestSide {
  database: DatabaseContext;
  repository: Repository;
  trustStore: TrustStore;
  transport: TestTransport;
  service: PairingService;
  hubId: string;
  hubSecretKey: string;
}

/** Structural mirror of the decrypted pairing wire message (PairingWireMessage). */
interface WireMessageLike {
  version: number;
  sessionId: string;
  kind: string;
  nonce: string;
  fromHubId: string;
  toHubId: string;
  mac: string;
  user?: {
    userId: string;
    userName: string;
    userPublicKey: string;
    hubId: string;
    signature: string;
  };
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
      hubSecretKey: hubKey.secretKey,
    };
  }

  async function reachApproval(a: TestSide, b: TestSide) {
    const created = a.service.createInvitation(b.hubId);
    const accepted = await b.service.acceptInvitation(created.pairingPackage);
    await a.service.onEnvelope(b.transport.take());
    await b.service.onEnvelope(a.transport.take());
    return { created, accepted };
  }

  async function decryptOn(receiving: TestSide, envelope: HubEnvelope): Promise<WireMessageLike> {
    return decryptPayload<WireMessageLike>(
      envelope.ciphertext,
      envelope.nonce,
      envelope.from,
      receiving.hubSecretKey,
    );
  }

  function parsePairingPackage(pairingPackage: string): {
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

  function macFor(secret: string, message: Omit<WireMessageLike, "mac" | "user">): string {
    return createHmac("sha256", Buffer.from(secret, "base64url"))
      .update(canonicalize(message))
      .digest("base64url");
  }

  function macValid(secret: string, message: WireMessageLike): boolean {
    const expected = Buffer.from(
      macFor(secret, {
        version: message.version,
        sessionId: message.sessionId,
        kind: message.kind,
        nonce: message.nonce,
        fromHubId: message.fromHubId,
        toHubId: message.toHubId,
      }),
      "base64url",
    );
    const received = Buffer.from(message.mac, "base64url");
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  function signingFields(envelope: HubEnvelope): Omit<HubEnvelope, "signature"> {
    return {
      id: envelope.id,
      from: envelope.from,
      to: envelope.to,
      type: envelope.type,
      timestamp: envelope.timestamp,
      nonce: envelope.nonce,
      ciphertext: envelope.ciphertext,
    };
  }

  function userCardFor(userName: string, hubId: string): NonNullable<WireMessageLike["user"]> {
    const key = generateUserKeyPair();
    const unsigned = {
      userId: deriveUserId(key.publicKey),
      userName,
      userPublicKey: key.publicKey,
      hubId,
    };
    return { ...unsigned, signature: signUserData(key.privateKey, unsigned) };
  }

  async function sealedEnvelope(
    sender: TestSide,
    recipient: TestSide,
    message: WireMessageLike,
  ): Promise<HubEnvelope> {
    const encrypted = await encryptPayload(message, recipient.hubId, sender.hubSecretKey);
    const unsignedEnvelope: Omit<HubEnvelope, "signature"> = {
      id: randomUUID(),
      from: sender.hubId,
      to: recipient.hubId,
      type: "pairing",
      timestamp: Date.now(),
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
    };
    return {
      ...unsignedEnvelope,
      signature: await signEnvelope(unsignedEnvelope, sender.hubSecretKey),
    };
  }

  /** Builds a correctly sealed wire message for `sender` -> `recipient`, with chosen overrides.
   *
   * Mirrors the production MAC rule: the HMAC covers the message WITHOUT the user card.
   */
  async function forgedEnvelope(
    sender: TestSide,
    recipient: TestSide,
    invitation: { sessionId: string; secret: string; nonce: string },
    overrides: Partial<WireMessageLike>,
  ): Promise<HubEnvelope> {
    const message = {
      version: 1,
      sessionId: invitation.sessionId,
      kind: "response",
      nonce: invitation.nonce,
      fromHubId: sender.hubId,
      toHubId: recipient.hubId,
      ...overrides,
    };
    const { user, ...macFields } = message;
    return sealedEnvelope(sender, recipient, {
      ...message,
      mac: macFor(invitation.secret, macFields),
      ...(user ? { user } : {}),
    });
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

  it("ignores envelopes that are not pairing messages or not addressed to this Hub", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const created = a.service.createInvitation(b.hubId);
    await b.service.acceptInvitation(created.pairingPackage);
    const response = b.transport.take();
    await a.service.onEnvelope(response);
    await b.service.onEnvelope(a.transport.take());

    const wrongType: HubEnvelope = {
      id: randomUUID(),
      from: b.hubId,
      to: a.hubId,
      type: "direct",
      timestamp: Date.now(),
      nonce: response.nonce,
      ciphertext: response.ciphertext,
      signature: response.signature,
    };
    const wrongRecipient: HubEnvelope = { ...response, to: "broadcast" };
    await expect(a.service.onEnvelope(wrongType)).resolves.toBeUndefined();
    await expect(a.service.onEnvelope(wrongRecipient)).resolves.toBeUndefined();
    expect(a.transport.sent).toHaveLength(0); // no reply went out for either envelope
    expect(b.transport.sent).toHaveLength(0);
    expect(a.service.get(created.session.sessionId)).toMatchObject({
      status: "awaiting_approval",
      localApproved: false,
      peerApproved: false,
    });
  });

  it("rejects unknown pairing kinds without corrupting the active session", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const created = a.service.createInvitation(b.hubId);
    await b.service.acceptInvitation(created.pairingPackage);
    await a.service.onEnvelope(b.transport.take());
    await b.service.onEnvelope(a.transport.take());
    const invitation = parsePairingPackage(created.pairingPackage);

    const unexpected = await forgedEnvelope(b, a, invitation, { kind: "revoke" });
    await expect(a.service.onEnvelope(unexpected)).rejects.toThrow(
      "Unexpected revoke pairing message",
    );
    expect(a.service.get(created.session.sessionId)).toMatchObject({
      status: "awaiting_approval",
      localApproved: false,
      peerApproved: false,
      error: undefined,
    });
    expect(a.transport.sent).toHaveLength(0); // no reply went out for the bogus kind
    expect(b.transport.sent).toHaveLength(0);
  });

  it("fails closed on version or nonce transcript mismatches", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const first = a.service.createInvitation(b.hubId);
    await b.service.acceptInvitation(first.pairingPackage);
    const firstInvitation = parsePairingPackage(first.pairingPackage);

    const wrongVersion = await forgedEnvelope(b, a, firstInvitation, { version: 2 });
    await expect(a.service.onEnvelope(wrongVersion)).rejects.toThrow(
      "Pairing transcript verification failed",
    );
    expect(a.service.get(first.session.sessionId)).toMatchObject({
      status: "failed",
      error: "Pairing transcript verification failed",
    });
    expect(a.transport.sent).toHaveLength(0);

    const second = a.service.createInvitation(b.hubId);
    await b.service.acceptInvitation(second.pairingPackage);
    const secondInvitation = parsePairingPackage(second.pairingPackage);
    const wrongNonce = await forgedEnvelope(
      b,
      a,
      { ...secondInvitation, nonce: "replayed-nonce" },
      {},
    );
    await expect(a.service.onEnvelope(wrongNonce)).rejects.toThrow(
      "Pairing transcript verification failed",
    );
    expect(a.service.get(second.session.sessionId)?.status).toBe("failed");
    expect(a.trustStore.isTrusted(b.hubId)).toBe(false);
    expect(a.transport.sent).toHaveLength(0);
  });

  it("fails closed when the response carries an invalid User identity proof", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const created = a.service.createInvitation(b.hubId);
    await b.service.acceptInvitation(created.pairingPackage);
    const invitation = parsePairingPackage(created.pairingPackage);
    const card = userCardFor("Mallory", b.hubId);

    const wrongHubCard = await forgedEnvelope(b, a, invitation, {
      user: { ...card, hubId: a.hubId },
    });
    await expect(a.service.onEnvelope(wrongHubCard)).rejects.toThrow(
      "Remote User identity proof is invalid",
    );
    expect(a.service.get(created.session.sessionId)).toMatchObject({
      status: "failed",
      error: "Remote User identity proof is invalid",
    });

    const second = a.service.createInvitation(b.hubId);
    await b.service.acceptInvitation(second.pairingPackage);
    const tamperedName = await forgedEnvelope(b, a, parsePairingPackage(second.pairingPackage), {
      user: { ...card, userName: "Tampered" },
    });
    await expect(a.service.onEnvelope(tamperedName)).rejects.toThrow(
      "Remote User identity proof is invalid",
    );
    expect(a.service.get(second.session.sessionId)?.status).toBe("failed");
    expect(a.trustStore.isTrusted(b.hubId)).toBe(false);
    expect(a.transport.sent).toHaveLength(0); // never confirm an unproven identity
  });

  it("fires onTrusted with the remote Hub ID once both sides have approved", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const onTrustedA = vi.fn();
    const onTrustedB = vi.fn();
    a.service.onTrusted = onTrustedA;
    b.service.onTrusted = onTrustedB;
    const { created, accepted } = await reachApproval(a, b);

    expect(onTrustedA).not.toHaveBeenCalled();
    expect(onTrustedB).not.toHaveBeenCalled();

    await a.service.approve(created.session.sessionId);
    expect(onTrustedA).not.toHaveBeenCalled(); // peer approval still pending

    await b.service.onEnvelope(a.transport.take());
    expect(onTrustedB).not.toHaveBeenCalled(); // B still owes its own approval

    await b.service.approve(accepted.sessionId);
    expect(onTrustedB).toHaveBeenCalledTimes(1);
    expect(onTrustedB).toHaveBeenCalledWith(a.hubId);
    expect(onTrustedA).not.toHaveBeenCalled(); // A does not know about B yet

    await a.service.onEnvelope(b.transport.take());
    expect(onTrustedA).toHaveBeenCalledTimes(1);
    expect(onTrustedA).toHaveBeenCalledWith(b.hubId);
    expect(a.service.get(created.session.sessionId)).toMatchObject({
      status: "trusted",
      remoteUserName: "Bob",
    });
    expect(b.service.get(accepted.sessionId)).toMatchObject({
      status: "trusted",
      remoteUserName: "Alice",
    });
  });

  it("rejects approve/cancel for unknown sessions and keeps a trusted session terminal", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const { created, accepted } = await reachApproval(a, b);
    const missing = "00000000-0000-0000-0000-000000000000";

    expect(a.service.get(missing)).toBeUndefined();
    await expect(a.service.approve(missing)).rejects.toThrow("Pairing session not found");
    await expect(a.service.cancel(missing)).rejects.toThrow("Pairing session not found");

    await a.service.approve(created.session.sessionId);
    expect(a.transport.sent).toHaveLength(1); // exactly one approve envelope
    await b.service.onEnvelope(a.transport.take());
    await b.service.approve(accepted.sessionId);
    await a.service.onEnvelope(b.transport.take());
    expect(a.service.get(created.session.sessionId)).toMatchObject({ status: "trusted" });

    await expect(a.service.approve(created.session.sessionId)).rejects.toThrow(
      "Pairing session is trusted",
    );
    await expect(a.service.cancel(created.session.sessionId)).rejects.toThrow(
      "Pairing session is trusted",
    );
    expect(a.transport.sent).toHaveLength(0); // rejections on the terminal session sent nothing
  });

  it("rejects a second cancel and later traffic once a session is cancelled", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const created = a.service.createInvitation(b.hubId);
    await b.service.acceptInvitation(created.pairingPackage);
    await a.service.onEnvelope(b.transport.take());
    await b.service.onEnvelope(a.transport.take());
    const invitation = parsePairingPackage(created.pairingPackage);

    const cancelled = await a.service.cancel(created.session.sessionId);
    expect(cancelled).toMatchObject({ status: "cancelled" });
    expect(a.transport.sent).toHaveLength(1); // exactly one cancel envelope

    // cancel is not idempotent: the second call hits the terminal-session guard.
    await expect(a.service.cancel(created.session.sessionId)).rejects.toThrow(
      "Pairing session is cancelled",
    );
    await expect(a.service.approve(created.session.sessionId)).rejects.toThrow(
      "Pairing session is cancelled",
    );
    expect(a.transport.sent).toHaveLength(1); // no extra traffic for either rejection

    const cancelEnvelope = a.transport.take();
    await b.service.onEnvelope(cancelEnvelope);
    expect(b.service.get(created.session.sessionId)).toMatchObject({ status: "cancelled" });
    await expect(b.service.approve(created.session.sessionId)).rejects.toThrow(
      "Pairing session is cancelled",
    );

    // Replaying the exact cancel envelope is silently deduplicated, not an error.
    await expect(b.service.onEnvelope(cancelEnvelope)).resolves.toBeUndefined();
    expect(b.service.get(created.session.sessionId)).toMatchObject({ status: "cancelled" });

    // Fresh, correctly sealed approve traffic still hits the terminal-session guard.
    const lateApprove = await forgedEnvelope(a, b, invitation, { kind: "approve" });
    await expect(b.service.onEnvelope(lateApprove)).rejects.toThrow("Pairing session is cancelled");
  });

  it("ignores exact replays of an already-processed pairing envelope", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const created = a.service.createInvitation(b.hubId);
    await b.service.acceptInvitation(created.pairingPackage);
    const invitation = parsePairingPackage(created.pairingPackage);
    const replayed = await forgedEnvelope(b, a, invitation, { user: userCardFor("Bob", b.hubId) });

    await a.service.onEnvelope(replayed);
    // A valid response (with User proof) advances straight to awaiting_approval and emits one confirm.
    expect(a.service.get(created.session.sessionId)).toMatchObject({ status: "awaiting_approval" });
    expect(a.transport.sent).toHaveLength(1);
    const confirm = a.transport.take();

    await a.service.onEnvelope(replayed);
    await a.service.onEnvelope(replayed);
    expect(a.service.get(created.session.sessionId)).toMatchObject({ status: "awaiting_approval" });
    expect(a.transport.sent).toHaveLength(0); // replay produced no duplicate confirm

    await b.service.onEnvelope(confirm);
    expect(b.service.get(created.session.sessionId)).toMatchObject({ status: "awaiting_approval" });
  });

  it("sends a complete, MAC-valid approve message when the local side approves", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const created = a.service.createInvitation(b.hubId);
    await b.service.acceptInvitation(created.pairingPackage);
    await a.service.onEnvelope(b.transport.take());
    await b.service.onEnvelope(a.transport.take());

    const approved = await a.service.approve(created.session.sessionId);
    expect(approved).toMatchObject({
      status: "awaiting_approval", // peer has not approved yet
      localApproved: true,
      peerApproved: false,
    });

    const approveEnvelope = a.transport.take();
    expect(approveEnvelope.type).toBe("pairing");
    expect(approveEnvelope.from).toBe(a.hubId);
    expect(approveEnvelope.to).toBe(b.hubId);
    await expect(
      verifySignature(signingFields(approveEnvelope), approveEnvelope.signature, a.hubId),
    ).resolves.toBe(true);

    const approveMessage = await decryptOn(b, approveEnvelope);
    const invitation = parsePairingPackage(created.pairingPackage);
    expect(approveMessage).toMatchObject({
      version: 1,
      sessionId: invitation.sessionId,
      kind: "approve",
      nonce: invitation.nonce,
      fromHubId: a.hubId,
      toHubId: b.hubId,
    });
    expect(approveMessage.user).toBeUndefined();
    expect(macValid(invitation.secret, approveMessage)).toBe(true);

    await b.service.onEnvelope(approveEnvelope);
    expect(b.service.get(created.session.sessionId)).toMatchObject({
      status: "awaiting_approval",
      localApproved: false,
      peerApproved: true,
    });
  });

  it("rejects transcript traffic for a session this Hub never created", async () => {
    const a = await side("Alice");
    const b = await side("Bob");
    const created = a.service.createInvitation(b.hubId);
    await b.service.acceptInvitation(created.pairingPackage);
    const stranger = await side("Dave");

    const misdelivered = await forgedEnvelope(
      b,
      stranger,
      parsePairingPackage(created.pairingPackage),
      { user: userCardFor("Bob", b.hubId) },
    );
    await expect(stranger.service.onEnvelope(misdelivered)).rejects.toThrow(
      "Unknown pairing session",
    );
    expect(stranger.transport.sent).toHaveLength(0);
    expect(stranger.service.list()).toEqual([]);
  });
});
