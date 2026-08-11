import { createHash } from "node:crypto";
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

const DEFAULT_LOCAL_HUB_ID = "local-hub";

export class TrustStore {
  private readonly trusted = new Map<string, TrustedHub>();

  constructor(
    private readonly repository?: Repository,
    _localHubId = DEFAULT_LOCAL_HUB_ID,
  ) {
    for (const hub of repository?.listTrustedHubs() ?? []) {
      this.trusted.set(hub.hubId, { ...hub });
    }
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

  /** Persist a contact only after the pairing protocol has mutually confirmed both endpoints. */
  completePairing(
    hubId: string,
    identity: { userId: string; userName: string; userPublicKey: string },
  ): TrustedHub {
    const normalizedHubId = requireHubId(hubId);
    const current = this.trusted.get(normalizedHubId) ?? newHub(normalizedHubId);
    const trusted: TrustedHub = {
      ...current,
      ...identity,
      trustLevel: "trusted",
      pairedAt: Date.now(),
      lastSeenAt: Date.now(),
    };
    this.save(trusted);
    return { ...trusted };
  }

  block(hubId: string): void {
    const normalizedHubId = requireHubId(hubId);
    const current = this.trusted.get(normalizedHubId) ?? newHub(normalizedHubId);
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
