import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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

interface PairingCode {
  code: string;
  expiresAt: number;
}

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export class TrustStore {
  private readonly trusted = new Map<string, TrustedHub>();
  private readonly pairingCodes = new Map<string, PairingCode>();

  constructor(private readonly repository?: Repository) {
    for (const hub of repository?.listTrustedHubs() ?? []) {
      this.trusted.set(hub.hubId, { ...hub });
    }
  }

  /** Generate a one-time pairing code that remains valid for 10 minutes. */
  generatePairingCode(hubId: string): string {
    const normalizedHubId = requireHubId(hubId);
    const now = Date.now();
    const digest = createHash("sha256")
      .update(normalizedHubId)
      .update(String(now))
      .update(randomBytes(32))
      .digest();
    const code = String(digest.readUInt32BE(0) % 1_000_000).padStart(6, "0");
    const current = this.trusted.get(normalizedHubId);
    this.save({
      ...(current ?? newHub(normalizedHubId)),
      trustLevel: "pending",
    });
    this.pairingCodes.set(normalizedHubId, {
      code,
      expiresAt: now + PAIRING_CODE_TTL_MS,
    });
    return code;
  }

  /** Verify a pairing code and promote its Hub to trusted. */
  confirmPairing(hubId: string, code: string): boolean {
    const normalizedHubId = hubId.trim();
    const pending = this.pairingCodes.get(normalizedHubId);
    if (!pending) return false;
    if (Date.now() > pending.expiresAt) {
      this.pairingCodes.delete(normalizedHubId);
      return false;
    }
    if (!sameCode(pending.code, code)) return false;

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
    hubFingerprint: createHash("sha256").update(hubId).digest("hex").slice(0, 16),
    trustLevel: "pending",
  };
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
