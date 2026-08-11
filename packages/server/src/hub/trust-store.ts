import {
  createHash,
  createHmac,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto";
import { canonicalize } from "@chorus/shared";
import type { Repository } from "../db/repository.js";

export type TrustLevel = "pending" | "trusted" | "blocked";

export interface TrustedHub {
  hubId: string;
  hubFingerprint: string;
  userId?: string;
  userName?: string;
  userPublicKey?: string;
  trustLevel: TrustLevel;
  pairedAt?: number;
  lastSeenAt?: number;
  notes?: string;
}

export interface PairingChallenge {
  code: string;
  nonce: string;
  ephemeralPublicKey: string;
}

interface PendingPairing extends PairingChallenge {
  expiresAt: number;
  ephemeralPrivateKey: KeyObject;
  keyConfirmation: Buffer;
  sas: string;
}

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const PAIRING_CONFIRMATION_INFO = "chorus-pairing-confirmation-v1";
const DEFAULT_LOCAL_HUB_ID = "local-hub";

export class TrustStore {
  private readonly trusted = new Map<string, TrustedHub>();
  private readonly pairingCodes = new Map<string, PendingPairing>();

  constructor(
    private readonly repository?: Repository,
    private readonly localHubId = DEFAULT_LOCAL_HUB_ID,
  ) {
    for (const hub of repository?.listTrustedHubs() ?? []) {
      this.trusted.set(hub.hubId, { ...hub });
    }
  }

  /** Generate a one-time pairing code that remains valid for 10 minutes. */
  generatePairingCode(hubId: string): PairingChallenge {
    const normalizedHubId = requireHubId(hubId);
    const now = Date.now();
    const code = String(randomInt(1_000_000)).padStart(6, "0");
    const nonce = randomBytes(16).toString("base64url");
    const { privateKey, publicKey } = generateKeyPairSync("x25519");
    const ephemeralPublicKey = exportPublicKey(publicKey);
    const sharedSecret = diffieHellman({ privateKey, publicKey });
    const keyConfirmation = createKeyConfirmation(
      sharedSecret,
      code,
      this.localHubId,
      normalizedHubId,
      nonce,
      ephemeralPublicKey,
    );
    const sas = computeSAS(this.localHubId, normalizedHubId, nonce);
    const current = this.trusted.get(normalizedHubId);
    this.save({
      ...(current ?? newHub(normalizedHubId)),
      trustLevel: "pending",
    });
    this.pairingCodes.set(normalizedHubId, {
      code,
      nonce,
      ephemeralPublicKey,
      expiresAt: now + PAIRING_CODE_TTL_MS,
      ephemeralPrivateKey: privateKey,
      keyConfirmation,
      sas,
    });
    return { code, nonce, ephemeralPublicKey };
  }

  /** Return the short authentication string for a pending challenge. */
  getPairingSAS(hubId: string, nonce: string): string | undefined {
    const normalizedHubId = hubId.trim();
    const pending = this.pairingCodes.get(normalizedHubId);
    if (!pending || !sameValue(pending.nonce, nonce)) return undefined;
    return pending.sas;
  }

  /** Verify the complete pairing transcript and promote its Hub to trusted. */
  confirmPairing(
    hubId: string,
    code: string,
    nonce: string,
    peerEphemeralPublicKey: string,
  ): boolean {
    const normalizedHubId = hubId.trim();
    const pending = this.pairingCodes.get(normalizedHubId);
    if (!pending) return false;
    if (Date.now() > pending.expiresAt) {
      this.pairingCodes.delete(normalizedHubId);
      return false;
    }
    if (!sameCode(pending.code, code)) return false;
    if (!sameValue(pending.nonce, nonce)) return false;

    try {
      const peerPublicKey = importX25519PublicKey(peerEphemeralPublicKey);
      const sharedSecret = diffieHellman({
        privateKey: pending.ephemeralPrivateKey,
        publicKey: peerPublicKey,
      });
      const receivedConfirmation = createKeyConfirmation(
        sharedSecret,
        code,
        this.localHubId,
        normalizedHubId,
        nonce,
        peerEphemeralPublicKey,
      );
      if (!timingSafeEqual(pending.keyConfirmation, receivedConfirmation)) return false;

      const receivedSAS = computeSAS(this.localHubId, normalizedHubId, nonce);
      if (!sameValue(pending.sas, receivedSAS)) return false;
    } catch {
      return false;
    }

    this.pairingCodes.delete(normalizedHubId);
    const current = this.trusted.get(normalizedHubId) ?? newHub(normalizedHubId);
    this.save({ ...current, trustLevel: "trusted", pairedAt: Date.now() });
    return true;
  }

  /** Add a pending Hub discovered through a transport. */
  addPending(hubId: string): void {
    const normalizedHubId = requireHubId(hubId);
    if (this.trusted.has(normalizedHubId)) return;
    this.save(newHub(normalizedHubId));
  }

  get(hubId: string): TrustedHub | undefined {
    const hub = this.trusted.get(hubId);
    return hub ? { ...hub } : undefined;
  }

  isTrusted(hubId: string): boolean {
    return this.trusted.get(hubId)?.trustLevel === "trusted";
  }

  block(hubId: string): void {
    const normalizedHubId = requireHubId(hubId);
    const current = this.trusted.get(normalizedHubId) ?? newHub(normalizedHubId);
    this.pairingCodes.delete(normalizedHubId);
    this.save({ ...current, trustLevel: "blocked" });
  }

  /** Downgrade a paired Hub when its pinned User public key changes. */
  detectKeyChange(hubId: string, currentPublicKey: string): boolean {
    const hub = this.trusted.get(hubId);
    if (!hub?.userPublicKey || hub.userPublicKey === currentPublicKey) return false;
    this.save({ ...hub, trustLevel: "pending" });
    return true;
  }

  /** Persist directory identity data and update the Hub's last-seen timestamp. */
  recordSeen(
    hubId: string,
    identity: Pick<TrustedHub, "userId" | "userName" | "userPublicKey"> = {},
  ): void {
    const hub = this.trusted.get(hubId);
    if (!hub) return;
    this.save({ ...hub, ...identity, lastSeenAt: Date.now() });
  }

  listTrusted(): TrustedHub[] {
    return [...this.trusted.values()]
      .filter((hub) => hub.trustLevel === "trusted")
      .map((hub) => ({ ...hub }));
  }

  remove(hubId: string): void {
    this.pairingCodes.delete(hubId);
    this.trusted.delete(hubId);
    this.repository?.removeTrustedHub(hubId);
  }

  private save(hub: TrustedHub): void {
    this.trusted.set(hub.hubId, { ...hub });
    this.repository?.upsertTrustedHub(hub);
  }
}

function newHub(hubId: string): TrustedHub {
  return {
    hubId,
    hubFingerprint: fingerprintHubId(hubId),
    trustLevel: "pending",
  };
}

function fingerprintHubId(hubId: string): string {
  const bytes = /^[0-9a-f]{64}$/iu.test(hubId) ? Buffer.from(hubId, "hex") : Buffer.from(hubId);
  return createHash("sha256").update(bytes).digest("hex").slice(0, 32);
}

function requireHubId(hubId: string): string {
  const normalized = hubId.trim();
  if (!normalized) throw new Error("hubId must be a non-empty string");
  return normalized;
}

function sameCode(expected: string, received: string): boolean {
  if (!/^\d{6}$/.test(received)) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

function sameValue(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length
    && timingSafeEqual(expectedBytes, receivedBytes);
}

function exportPublicKey(publicKey: KeyObject): string {
  return publicKey.export({ format: "der", type: "spki" }).toString("base64");
}

function importX25519PublicKey(encoded: string): KeyObject {
  const publicKey = createPublicKey({
    key: Buffer.from(encoded, "base64"),
    format: "der",
    type: "spki",
  });
  if (publicKey.asymmetricKeyType !== "x25519" || exportPublicKey(publicKey) !== encoded) {
    throw new Error("Invalid X25519 public key");
  }
  return publicKey;
}

function createKeyConfirmation(
  sharedSecret: Buffer,
  code: string,
  hubIdA: string,
  hubIdB: string,
  nonce: string,
  ephemeralPublicKey: string,
): Buffer {
  const hubIds = [hubIdA, hubIdB].sort();
  const info = Buffer.from(canonicalize({ hubIds, nonce, purpose: PAIRING_CONFIRMATION_INFO }));
  const confirmationKey = Buffer.from(
    hkdfSync("sha256", sharedSecret, Buffer.from(code), info, 32),
  );
  const transcript = canonicalize({ ephemeralPublicKey, hubIds, nonce });
  return createHmac("sha256", confirmationKey).update(transcript).digest();
}

export function computeSAS(hubIdA: string, hubIdB: string, nonce: string): string {
  const hubIds = [hubIdA, hubIdB].sort();
  const digest = createHash("sha256")
    .update(canonicalize({ hubIds, nonce }))
    .digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}
