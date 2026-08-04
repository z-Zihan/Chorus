import { createHash, randomBytes } from "node:crypto";

export interface ClientToken {
  id: string;
  hash: string;
  clientId: string;
  userId?: string;
  scopes: string[];
  expiresAt: number;
  createdAt: number;
  lastUsedAt?: number;
  revoked: boolean;
}

export interface ClientTokenRepository {
  createClientToken(token: ClientToken): void;
  listClientTokens(): ClientToken[];
  updateClientTokenLastUsed(id: string, lastUsedAt: number): boolean;
  revokeClientToken(id: string): boolean;
  purgeExpiredClientTokens(now?: number): number;
}

export class TokenStore {
  private readonly tokens = new Map<string, ClientToken>();

  constructor(private readonly repository?: ClientTokenRepository) {
    for (const token of repository?.listClientTokens() ?? []) {
      this.tokens.set(token.id, token);
    }
  }

  /** Create a new token, returns plaintext (only shown once). */
  create(
    clientId: string,
    scopes: string[],
    ttlMs: number,
    userId?: string,
  ): { token: string; id: string } {
    if (!clientId.trim()) throw new Error("clientId must be a non-empty string");
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("ttlMs must be greater than zero");

    const id = `tok_${randomBytes(12).toString("base64url")}`;
    const token = `${id}.${randomBytes(32).toString("base64url")}`;
    const now = Date.now();
    const record: ClientToken = {
      id,
      hash: hashToken(token),
      clientId: clientId.trim(),
      userId: userId?.trim() || undefined,
      scopes: [...new Set(scopes)],
      expiresAt: now + ttlMs,
      createdAt: now,
      revoked: false,
    };
    this.repository?.createClientToken(record);
    this.tokens.set(id, record);
    return { token, id };
  }

  /** Verify a plaintext token, returns token record if valid. */
  verify(plaintext: string): ClientToken | null {
    if (!plaintext) return null;
    const hash = hashToken(plaintext);
    const record = [...this.tokens.values()].find((candidate) => candidate.hash === hash);
    if (!record || record.revoked || record.expiresAt <= Date.now()) return null;

    record.lastUsedAt = Date.now();
    this.repository?.updateClientTokenLastUsed(record.id, record.lastUsedAt);
    return { ...record, scopes: [...record.scopes] };
  }

  /** Revoke a token by ID. */
  revoke(id: string): boolean {
    const record = this.tokens.get(id);
    if (!record || record.revoked) return false;
    record.revoked = true;
    this.repository?.revokeClientToken(id);
    return true;
  }

  /** List all active tokens. */
  list(): ClientToken[] {
    const now = Date.now();
    return [...this.tokens.values()]
      .filter((token) => !token.revoked && token.expiresAt > now)
      .map((token) => ({ ...token, scopes: [...token.scopes] }));
  }

  /** Clean up expired tokens. */
  purgeExpired(): number {
    const now = Date.now();
    let purged = 0;
    for (const [id, token] of this.tokens) {
      if (token.expiresAt <= now) {
        this.tokens.delete(id);
        purged += 1;
      }
    }
    this.repository?.purgeExpiredClientTokens(now + 1);
    return purged;
  }
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function tokenHasScope(token: ClientToken, scope: string): boolean {
  return token.scopes.includes(scope) || token.scopes.includes("*");
}
