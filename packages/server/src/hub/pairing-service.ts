import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { canonicalize, type HubEnvelope } from "@chorus/shared";
import type { Repository } from "../db/repository.js";
import { getUserKey } from "../credential-store.js";
import type { UserKeyPair } from "../identity/user-keys.js";
import {
  deriveUserId,
  signData as signUserData,
  verifySignature as verifyUserSignature,
} from "../identity/user-keys.js";
import { decryptPayload, encryptPayload, signEnvelope, verifySignature } from "./crypto.js";
import type { TrustStore } from "./trust-store.js";

const PAIRING_TTL_MS = 10 * 60 * 1000;
const PAIRING_CLOCK_SKEW_MS = 60 * 1000;
const PROTOCOL_VERSION = 1;

type PairingRole = "initiator" | "responder";
export type PairingStatus =
  | "waiting_peer"
  | "verifying"
  | "awaiting_approval"
  | "trusted"
  | "cancelled"
  | "expired"
  | "failed";
type WireKind = "response" | "confirm" | "approve" | "cancel";

interface PairingInvitation {
  version: 1;
  sessionId: string;
  secret: string;
  nonce: string;
  initiatorHubId: string;
  targetHubId: string;
  expiresAt: number;
}

interface PairingUserCard {
  userId: string;
  userName: string;
  userPublicKey: string;
  hubId: string;
  signature: string;
}

interface PairingWireMessage {
  version: 1;
  sessionId: string;
  kind: WireKind;
  nonce: string;
  fromHubId: string;
  toHubId: string;
  mac: string;
  user?: PairingUserCard;
}

interface PairingSession extends PairingInvitation {
  role: PairingRole;
  remoteHubId: string;
  status: PairingStatus;
  sas: string;
  localApproved: boolean;
  peerApproved: boolean;
  remoteUser?: PairingUserCard;
  error?: string;
}

export interface PairingSessionView {
  sessionId: string;
  role: PairingRole;
  remoteHubId: string;
  status: PairingStatus;
  sas?: string;
  expiresAt: number;
  localApproved: boolean;
  peerApproved: boolean;
  remoteUserName?: string;
  error?: string;
}

interface PairingHubIdentity {
  readonly hubId: string;
  getSecretKey(): Promise<string>;
}

interface PairingTransport {
  readonly state: string;
  sendEnvelope(envelope: HubEnvelope): void;
}

export class PairingService {
  private readonly sessions = new Map<string, PairingSession>();
  private readonly seenEnvelopeIds = new Set<string>();

  constructor(
    private readonly identity: PairingHubIdentity,
    private readonly relayClient: PairingTransport,
    private readonly trustStore: TrustStore,
    private readonly repository: Repository,
    private readonly localUserName: string,
    private readonly localUserKey?: UserKeyPair,
  ) {}

  createInvitation(targetHubId: string): { pairingPackage: string; session: PairingSessionView } {
    const target = requireHubId(targetHubId);
    if (target === this.identity.hubId) throw new Error("Cannot pair a Hub with itself");
    if (!/^[0-9a-f]{64}$/iu.test(target))
      throw new Error("targetHubId must be a 32-byte Ed25519 public key");
    const invitation: PairingInvitation = {
      version: PROTOCOL_VERSION,
      sessionId: randomUUID(),
      secret: randomBytes(32).toString("base64url"),
      nonce: randomBytes(16).toString("base64url"),
      initiatorHubId: this.identity.hubId,
      targetHubId: target,
      expiresAt: Date.now() + PAIRING_TTL_MS,
    };
    const session = this.storeSession(invitation, "initiator", target, "waiting_peer");
    return {
      pairingPackage: Buffer.from(canonicalize(invitation), "utf8").toString("base64url"),
      session: this.view(session),
    };
  }

  async acceptInvitation(pairingPackage: string): Promise<PairingSessionView> {
    const invitation = parseInvitation(pairingPackage);
    if (invitation.targetHubId !== this.identity.hubId)
      throw new Error("Pairing package targets another Hub");
    if (invitation.initiatorHubId === this.identity.hubId)
      throw new Error("Cannot accept a local pairing package");
    if (Date.now() > invitation.expiresAt) throw new Error("Pairing package has expired");
    if (invitation.expiresAt > Date.now() + PAIRING_TTL_MS + PAIRING_CLOCK_SKEW_MS) {
      throw new Error("Pairing package expiry exceeds the allowed lifetime");
    }
    if (this.sessions.has(invitation.sessionId))
      throw new Error("Pairing package has already been used");
    const session = this.storeSession(
      invitation,
      "responder",
      invitation.initiatorHubId,
      "verifying",
    );
    await this.send(session, "response", await this.localUserCard());
    return this.view(session);
  }

  async approve(sessionId: string): Promise<PairingSessionView> {
    const session = this.requireActiveSession(sessionId);
    if (session.status !== "awaiting_approval")
      throw new Error("Pairing is not ready for approval");
    session.localApproved = true;
    await this.send(session, "approve");
    this.completeIfApproved(session);
    return this.view(session);
  }

  async cancel(sessionId: string): Promise<PairingSessionView> {
    const session = this.requireActiveSession(sessionId);
    session.status = "cancelled";
    await this.send(session, "cancel");
    return this.view(session);
  }

  get(sessionId: string): PairingSessionView | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    this.expire(session);
    return this.view(session);
  }

  list(): PairingSessionView[] {
    return [...this.sessions.values()].map((session) => {
      this.expire(session);
      return this.view(session);
    });
  }

  async onEnvelope(envelope: HubEnvelope): Promise<void> {
    if (envelope.type !== "pairing" || envelope.to !== this.identity.hubId) return;
    if (this.seenEnvelopeIds.has(envelope.id)) return;
    this.rememberEnvelope(envelope.id);
    if (!/^[0-9a-f]{64}$/iu.test(envelope.from)) throw new Error("Invalid pairing sender Hub ID");
    if (!(await verifySignature(signingData(envelope), envelope.signature, envelope.from))) {
      throw new Error("Invalid pairing envelope signature");
    }
    const message = await decryptPayload<PairingWireMessage>(
      envelope.ciphertext,
      envelope.nonce,
      envelope.from,
      await this.identity.getSecretKey(),
    );
    const session = this.sessions.get(message.sessionId);
    if (!session) throw new Error("Unknown pairing session");
    this.expire(session);
    if (
      session.status === "expired" ||
      session.status === "cancelled" ||
      session.status === "failed"
    ) {
      throw new Error(`Pairing session is ${session.status}`);
    }
    if (
      message.version !== PROTOCOL_VERSION ||
      message.nonce !== session.nonce ||
      message.fromHubId !== session.remoteHubId ||
      message.toHubId !== this.identity.hubId ||
      envelope.from !== session.remoteHubId ||
      !verifyMac(session, message)
    ) {
      session.status = "failed";
      session.error = "Pairing transcript verification failed";
      throw new Error(session.error);
    }
    if (message.user) {
      if (!verifyUserCard(message.user, session.remoteHubId)) {
        session.status = "failed";
        session.error = "Remote User identity proof is invalid";
        throw new Error(session.error);
      }
      session.remoteUser = message.user;
    }
    if (
      message.kind === "response" &&
      session.role === "initiator" &&
      session.status === "waiting_peer"
    ) {
      if (!session.remoteUser) throw new Error("Pairing response has no User identity proof");
      session.status = "verifying";
      await this.send(session, "confirm", await this.localUserCard());
      session.status = "awaiting_approval";
    } else if (
      message.kind === "confirm" &&
      session.role === "responder" &&
      session.status === "verifying"
    ) {
      if (!session.remoteUser) throw new Error("Pairing confirmation has no User identity proof");
      session.status = "awaiting_approval";
    } else if (message.kind === "approve" && session.status === "awaiting_approval") {
      session.peerApproved = true;
      this.completeIfApproved(session);
    } else if (message.kind === "cancel") {
      session.status = "cancelled";
    } else {
      throw new Error(`Unexpected ${message.kind} pairing message`);
    }
  }

  private storeSession(
    invitation: PairingInvitation,
    role: PairingRole,
    remoteHubId: string,
    status: PairingStatus,
  ): PairingSession {
    const session: PairingSession = {
      ...invitation,
      role,
      remoteHubId,
      status,
      sas: computePairingSAS(invitation),
      localApproved: false,
      peerApproved: false,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  private async send(
    session: PairingSession,
    kind: WireKind,
    user?: PairingUserCard,
  ): Promise<void> {
    if (this.relayClient.state !== "connected")
      throw new Error("Relay must be connected for pairing");
    const unsignedMessage = {
      version: PROTOCOL_VERSION,
      sessionId: session.sessionId,
      kind,
      nonce: session.nonce,
      fromHubId: this.identity.hubId,
      toHubId: session.remoteHubId,
    } as const;
    const message: PairingWireMessage = {
      ...unsignedMessage,
      mac: createMac(session.secret, unsignedMessage),
      ...(user ? { user } : {}),
    };
    const encrypted = await encryptPayload(
      message,
      session.remoteHubId,
      await this.identity.getSecretKey(),
    );
    const unsignedEnvelope: Omit<HubEnvelope, "signature"> = {
      id: randomUUID(),
      from: this.identity.hubId,
      to: session.remoteHubId,
      type: "pairing",
      timestamp: Date.now(),
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
    };
    this.relayClient.sendEnvelope({
      ...unsignedEnvelope,
      signature: await signEnvelope(
        signingData(unsignedEnvelope),
        await this.identity.getSecretKey(),
      ),
    });
  }

  private async localUserCard(): Promise<PairingUserCard> {
    const key = this.localUserKey ?? (await getUserKey());
    if (!key) throw new Error("Local User identity is unavailable");
    const unsigned = {
      userId: deriveUserId(key.publicKey),
      userName: this.localUserName,
      userPublicKey: key.publicKey,
      hubId: this.identity.hubId,
    };
    return { ...unsigned, signature: signUserData(key.privateKey, unsigned) };
  }

  private completeIfApproved(session: PairingSession): void {
    if (!session.localApproved || !session.peerApproved || !session.remoteUser) return;
    session.status = "trusted";
    const now = Date.now();
    this.repository.upsertRemoteUser({
      id: session.remoteUser.userId,
      name: session.remoteUser.userName,
      publicKey: session.remoteUser.userPublicKey,
      hubId: session.remoteHubId,
      kind: "remote",
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    });
    this.trustStore.completePairing(session.remoteHubId, {
      userId: session.remoteUser.userId,
      userName: session.remoteUser.userName,
      userPublicKey: session.remoteUser.userPublicKey,
    });
  }

  private requireActiveSession(sessionId: string): PairingSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Pairing session not found");
    this.expire(session);
    if (["trusted", "cancelled", "expired", "failed"].includes(session.status)) {
      throw new Error(`Pairing session is ${session.status}`);
    }
    return session;
  }

  private expire(session: PairingSession): void {
    if (
      Date.now() > session.expiresAt &&
      !["trusted", "cancelled", "failed"].includes(session.status)
    ) {
      session.status = "expired";
    }
  }

  private view(session: PairingSession): PairingSessionView {
    return {
      sessionId: session.sessionId,
      role: session.role,
      remoteHubId: session.remoteHubId,
      status: session.status,
      ...(session.status === "awaiting_approval" || session.status === "trusted"
        ? { sas: session.sas }
        : {}),
      expiresAt: session.expiresAt,
      localApproved: session.localApproved,
      peerApproved: session.peerApproved,
      remoteUserName: session.remoteUser?.userName,
      error: session.error,
    };
  }

  private rememberEnvelope(id: string): void {
    this.seenEnvelopeIds.add(id);
    if (this.seenEnvelopeIds.size > 1_000) {
      const first = this.seenEnvelopeIds.values().next().value as string | undefined;
      if (first) this.seenEnvelopeIds.delete(first);
    }
  }
}

function parseInvitation(value: string): PairingInvitation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value.trim(), "base64url").toString("utf8"));
  } catch {
    throw new Error("Pairing package is invalid");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Pairing package is invalid");
  const invite = parsed as Partial<PairingInvitation>;
  if (
    invite.version !== PROTOCOL_VERSION ||
    typeof invite.sessionId !== "string" ||
    typeof invite.secret !== "string" ||
    Buffer.from(invite.secret, "base64url").length !== 32 ||
    typeof invite.nonce !== "string" ||
    Buffer.from(invite.nonce, "base64url").length !== 16 ||
    typeof invite.initiatorHubId !== "string" ||
    !/^[0-9a-f]{64}$/iu.test(invite.initiatorHubId) ||
    typeof invite.targetHubId !== "string" ||
    !/^[0-9a-f]{64}$/iu.test(invite.targetHubId) ||
    typeof invite.expiresAt !== "number"
  ) {
    throw new Error("Pairing package is invalid");
  }
  return invite as PairingInvitation;
}

function createMac(secret: string, message: Omit<PairingWireMessage, "mac" | "user">): string {
  return createHmac("sha256", Buffer.from(secret, "base64url"))
    .update(canonicalize(message))
    .digest("base64url");
}

function verifyMac(session: PairingSession, message: PairingWireMessage): boolean {
  const expected = Buffer.from(
    createMac(session.secret, {
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

function verifyUserCard(card: PairingUserCard, expectedHubId: string): boolean {
  const unsigned = {
    userId: card.userId,
    userName: card.userName,
    userPublicKey: card.userPublicKey,
    hubId: card.hubId,
  };
  return (
    card.hubId === expectedHubId &&
    deriveUserId(card.userPublicKey) === card.userId &&
    verifyUserSignature(card.userPublicKey, unsigned, card.signature)
  );
}

function computePairingSAS(invitation: PairingInvitation): string {
  const digest = createHmac("sha256", Buffer.from(invitation.secret, "base64url"))
    .update(
      canonicalize({
        sessionId: invitation.sessionId,
        nonce: invitation.nonce,
        hubIds: [invitation.initiatorHubId, invitation.targetHubId].sort(),
      }),
    )
    .digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

function requireHubId(value: string): string {
  const hubId = value.trim();
  if (!hubId) throw new Error("targetHubId is required");
  return hubId;
}

function signingData(
  envelope: Omit<HubEnvelope, "signature"> | HubEnvelope,
): Omit<HubEnvelope, "signature"> {
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
