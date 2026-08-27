import {
  createHmac,
  createPublicKey,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
} from "node:crypto";
import { canonicalize, type TransportReceipt } from "@chorus/shared";

const TOKEN_HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
  "base64url",
);
const REGISTRATION_PURPOSE = "chorus-relay-registration-v1";
export const DEFAULT_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_CHALLENGE_TTL_MS = 2 * 60 * 1_000;
const DEFAULT_MAX_PENDING_CHALLENGES = 10_000;

export interface HubRegistrationChallenge {
  challengeId: string;
  nonce: string;
  hubId: string;
  publicKey: string;
  displayName: string;
  expiresAt: number;
  purpose: typeof REGISTRATION_PURPOSE;
}

export class RegistrationChallengeStore {
  private readonly challenges = new Map<string, HubRegistrationChallenge>();

  constructor(
    private readonly ttlMs = DEFAULT_CHALLENGE_TTL_MS,
    private readonly now: () => number = Date.now,
    private readonly maxPending = DEFAULT_MAX_PENDING_CHALLENGES,
  ) {}

  create(hubId: string, publicKey: string, displayName: string): HubRegistrationChallenge {
    this.cleanup();
    while (this.challenges.size >= this.maxPending) {
      const oldest = this.challenges.keys().next().value as string | undefined;
      if (!oldest) break;
      this.challenges.delete(oldest);
    }
    const challenge: HubRegistrationChallenge = {
      challengeId: randomUUID(),
      nonce: randomBytes(32).toString("base64url"),
      hubId,
      publicKey,
      displayName,
      expiresAt: this.now() + this.ttlMs,
      purpose: REGISTRATION_PURPOSE,
    };
    this.challenges.set(challenge.challengeId, challenge);
    return challenge;
  }

  consume(challengeId: string, signature: string): HubRegistrationChallenge | null {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) return null;
    if (challenge.expiresAt <= this.now()) {
      this.challenges.delete(challengeId);
      return null;
    }
    if (!verifyRegistrationSignature(challenge, signature)) return null;
    this.challenges.delete(challengeId);
    return challenge;
  }

  private cleanup(): void {
    const now = this.now();
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt <= now) this.challenges.delete(id);
    }
  }
}

export function createHubToken(
  hubId: string,
  secret: string,
  ttlSeconds = DEFAULT_TOKEN_TTL_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1_000),
  authVersion = 1,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: hubId,
      iat: nowSeconds,
      exp: nowSeconds + ttlSeconds,
      ver: authVersion,
    }),
  ).toString("base64url");
  const unsigned = `${TOKEN_HEADER}.${payload}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

export function verifyHubToken(
  token: string,
  hubId: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
  expectedAuthVersion?: number,
): boolean {
  const claims = authenticatedHubClaims(token, secret, nowSeconds);
  return (
    claims?.sub === hubId &&
    (expectedAuthVersion === undefined || claims.ver === expectedAuthVersion)
  );
}

export function authenticatedHubId(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): string | null {
  return authenticatedHubClaims(token, secret, nowSeconds)?.sub ?? null;
}

export function authenticatedHubClaims(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): { sub: string; iat: number; exp: number; ver: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  if (parts[0] !== TOKEN_HEADER) return null;
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", secret).update(unsigned).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(parts[2], "base64url");
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      sub?: unknown;
      iat?: unknown;
      exp?: unknown;
      ver?: unknown;
    };
    if (typeof payload.sub !== "string" || !payload.sub.trim()) return null;
    if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) return null;
    if (!Number.isInteger(payload.ver) || (payload.ver as number) < 1) return null;
    if ((payload.iat as number) > nowSeconds + 60 || (payload.exp as number) <= nowSeconds)
      return null;
    return {
      sub: payload.sub,
      iat: payload.iat as number,
      exp: payload.exp as number,
      ver: payload.ver as number,
    };
  } catch {
    return null;
  }
}

function verifyRegistrationSignature(
  challenge: HubRegistrationChallenge,
  signature: string,
): boolean {
  try {
    if (!/^[0-9a-f]{64}$/iu.test(challenge.publicKey) || challenge.hubId !== challenge.publicKey) {
      return false;
    }
    const key = createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: Buffer.from(challenge.publicKey, "hex").toString("base64url"),
      },
      format: "jwk",
    });
    return verify(
      null,
      Buffer.from(canonicalize(challenge), "utf8"),
      key,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

export function verifyTransportReceipt(receipt: TransportReceipt, publicKey: string): boolean {
  try {
    if (!/^[0-9a-f]{64}$/iu.test(publicKey) || receipt.recipientHubId !== publicKey) return false;
    const key = createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: Buffer.from(publicKey, "hex").toString("base64url"),
      },
      format: "jwk",
    });
    const { signature, ...signed } = receipt;
    return verify(
      null,
      Buffer.from(canonicalize(signed), "utf8"),
      key,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}
