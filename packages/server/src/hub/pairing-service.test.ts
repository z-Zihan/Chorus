import type { HubEnvelope } from "@chorus/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseContext } from "../db/index.js";
import { Repository } from "../db/repository.js";
import { generateUserKeyPair } from "../identity/user-keys.js";
import { generateHubKeypair } from "./crypto.js";
import { PairingService } from "./pairing-service.js";
import { TrustStore } from "./trust-store.js";

interface TestSide {
  database: DatabaseContext;
  repository: Repository;
  trustStore: TrustStore;
  transport: TestTransport;
  service: PairingService;
  hubId: string;
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
    return { database, repository, trustStore, transport, service, hubId: hubKey.publicKey };
  }

  async function reachApproval(a: TestSide, b: TestSide) {
    const created = a.service.createInvitation(b.hubId);
    const accepted = await b.service.acceptInvitation(created.pairingPackage);
    await a.service.onEnvelope(b.transport.take());
    await b.service.onEnvelope(a.transport.take());
    return { created, accepted };
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
});
