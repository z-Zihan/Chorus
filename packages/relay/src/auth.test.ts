import { createHmac, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { canonicalize, type TransportReceipt } from "@chorus/shared";
import { describe, expect, it } from "vitest";
import {
  authenticatedHubClaims,
  authenticatedHubId,
  createHubToken,
  DEFAULT_TOKEN_TTL_SECONDS,
  RegistrationChallengeStore,
  verifyHubToken,
  verifyTransportReceipt,
} from "./auth.js";

const SECRET = "relay-auth-test-secret";
const TOKEN_HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
  "base64url",
);

function ed25519Identity(): { publicKey: string; privateKey: KeyObject } {
  const keyPair = generateKeyPairSync("ed25519");
  const jwk = keyPair.publicKey.export({ format: "jwk" });
  if (!jwk.x) throw new Error("Missing Ed25519 public key");
  return {
    publicKey: Buffer.from(jwk.x, "base64url").toString("hex"),
    privateKey: keyPair.privateKey,
  };
}

function signCanonical(value: unknown, privateKey: KeyObject): string {
  return sign(null, Buffer.from(canonicalize(value), "utf8"), privateKey).toString("base64");
}

/** Builds a correctly HMAC-signed token around an arbitrary payload string. */
function signedToken(rawPayload: string, secret = SECRET): string {
  const unsigned = `${TOKEN_HEADER}.${Buffer.from(rawPayload, "utf8").toString("base64url")}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

describe("RegistrationChallengeStore", () => {
  function store(options: { ttlMs?: number; maxPending?: number } = {}) {
    const challenges = new RegistrationChallengeStore(
      options.ttlMs ?? 1_000,
      () => 10_000,
      options.maxPending,
    );
    return { challenges };
  }

  it("issues unique, purpose-bound challenges that expire after the TTL", () => {
    const { challenges } = store({ ttlMs: 1_000 });
    const identity = ed25519Identity();
    const first = challenges.create(identity.publicKey, identity.publicKey, "Hub A");
    const second = challenges.create(identity.publicKey, identity.publicKey, "Hub A");

    expect(first).toMatchObject({
      hubId: identity.publicKey,
      publicKey: identity.publicKey,
      displayName: "Hub A",
      expiresAt: 11_000,
      purpose: "chorus-relay-registration-v1",
    });
    expect(Buffer.from(first.nonce, "base64url")).toHaveLength(32);
    expect(second.challengeId).not.toBe(first.challengeId);
    expect(second.nonce).not.toBe(first.nonce);
  });

  it("consumes a correctly signed challenge exactly once", () => {
    const { challenges } = store();
    const identity = ed25519Identity();
    const challenge = challenges.create(identity.publicKey, identity.publicKey, "Hub A");
    const signature = signCanonical(challenge, identity.privateKey);

    expect(challenges.consume(challenge.challengeId, signature)).toEqual(challenge);
    expect(challenges.consume(challenge.challengeId, signature)).toBeNull();
  });

  it("rejects unknown challenge ids", () => {
    const { challenges } = store();
    expect(challenges.consume("missing-challenge", "c2ln")).toBeNull();
  });

  it("rejects and discards a challenge once its expiry is reached", () => {
    let now = 10_000;
    const challenges = new RegistrationChallengeStore(1_000, () => now);
    const identity = ed25519Identity();
    const challenge = challenges.create(identity.publicKey, identity.publicKey, "Hub A");
    const signature = signCanonical(challenge, identity.privateKey);

    now = challenge.expiresAt - 1;
    const stillValid = challenges.create(identity.publicKey, identity.publicKey, "Hub A");
    now = challenge.expiresAt;
    expect(challenges.consume(challenge.challengeId, signature)).toBeNull();

    // Rewinding the clock proves the expired entry was deleted, not merely rejected.
    now = 10_000;
    expect(challenges.consume(challenge.challengeId, signature)).toBeNull();
    expect(
      challenges.consume(stillValid.challengeId, signCanonical(stillValid, identity.privateKey)),
    ).toEqual(stillValid);
  });

  it("purges expired challenges when a new one is created", () => {
    let now = 10_000;
    const challenges = new RegistrationChallengeStore(1_000, () => now, 1);
    const identity = ed25519Identity();
    const expired = challenges.create(identity.publicKey, identity.publicKey, "Hub A");
    const expiredSignature = signCanonical(expired, identity.privateKey);

    now = expired.expiresAt;
    challenges.create(identity.publicKey, identity.publicKey, "Hub A");
    now = 10_000;
    expect(challenges.consume(expired.challengeId, expiredSignature)).toBeNull();
  });

  it("evicts the oldest pending challenges when capacity is reached", () => {
    const { challenges } = store({ maxPending: 2 });
    const identity = ed25519Identity();
    const [oldest, middle] = [
      challenges.create(identity.publicKey, identity.publicKey, "Hub A"),
      challenges.create(identity.publicKey, identity.publicKey, "Hub A"),
    ];
    const newest = challenges.create(identity.publicKey, identity.publicKey, "Hub A");

    expect(challenges.consume(oldest.challengeId, signCanonical(oldest, identity.privateKey))).toBe(
      null,
    );
    expect(
      challenges.consume(middle.challengeId, signCanonical(middle, identity.privateKey)),
    ).toEqual(middle);
    expect(
      challenges.consume(newest.challengeId, signCanonical(newest, identity.privateKey)),
    ).toEqual(newest);
  });

  it("keeps the challenge pending after an invalid signature", () => {
    const { challenges } = store();
    const identity = ed25519Identity();
    const attacker = ed25519Identity();
    const challenge = challenges.create(identity.publicKey, identity.publicKey, "Hub A");

    expect(
      challenges.consume(challenge.challengeId, signCanonical(challenge, attacker.privateKey)),
    ).toBeNull();
    expect(challenges.consume(challenge.challengeId, "not a signature")).toBeNull();
    expect(
      challenges.consume(challenge.challengeId, signCanonical(challenge, identity.privateKey)),
    ).toEqual(challenge);
  });

  it("rejects signatures over any field other than the issued challenge", () => {
    const { challenges } = store();
    const identity = ed25519Identity();
    const challenge = challenges.create(identity.publicKey, identity.publicKey, "Hub A");

    for (const altered of [
      { ...challenge, purpose: "chorus-relay-registration-v0" },
      { ...challenge, nonce: "other-nonce" },
      { ...challenge, displayName: "Hub B" },
      { ...challenge, expiresAt: challenge.expiresAt + 1 },
    ]) {
      expect(
        challenges.consume(challenge.challengeId, signCanonical(altered, identity.privateKey)),
      ).toBeNull();
    }
  });

  it("rejects challenges whose hub id is not the hex Ed25519 public key", () => {
    const { challenges } = store();
    const identity = ed25519Identity();
    const other = ed25519Identity();

    const mismatched = challenges.create(other.publicKey, identity.publicKey, "Hub A");
    expect(
      challenges.consume(mismatched.challengeId, signCanonical(mismatched, identity.privateKey)),
    ).toBeNull();

    const notHex = challenges.create("hub-a", "hub-a", "Hub A");
    expect(
      challenges.consume(notHex.challengeId, signCanonical(notHex, identity.privateKey)),
    ).toBeNull();

    const shortKey = identity.publicKey.slice(0, 62);
    const truncated = challenges.create(shortKey, shortKey, "Hub A");
    expect(
      challenges.consume(truncated.challengeId, signCanonical(truncated, identity.privateKey)),
    ).toBeNull();
  });

  it("rejects a 64-hex-character key that is not a valid Ed25519 point", () => {
    const { challenges } = store();
    const identity = ed25519Identity();
    const invalidPoint = "ff".repeat(32);
    const challenge = challenges.create(invalidPoint, invalidPoint, "Hub A");
    expect(
      challenges.consume(challenge.challengeId, signCanonical(challenge, identity.privateKey)),
    ).toBeNull();
  });
});

describe("Relay Hub tokens", () => {
  it("accepts a signed, unexpired token for its subject", () => {
    const token = createHubToken("hub-a", SECRET, 60, 1_000);
    expect(authenticatedHubId(token, SECRET, 1_059)).toBe("hub-a");
    expect(verifyHubToken(token, "hub-a", SECRET, 1_059)).toBe(true);
    expect(verifyHubToken(token, "hub-b", SECRET, 1_059)).toBe(false);
  });

  it("rejects expired, future-issued, tampered, and legacy tokens", () => {
    const expired = createHubToken("hub-a", SECRET, 60, 1_000);
    expect(authenticatedHubId(expired, SECRET, 1_060)).toBeNull();

    const future = createHubToken("hub-a", SECRET, 60, 2_000);
    expect(authenticatedHubId(future, SECRET, 1_000)).toBeNull();

    const parts = expired.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: "hub-b", iat: 1_000, exp: 2_000, ver: 1 }),
    ).toString("base64url");
    expect(
      authenticatedHubId(`${parts[0]}.${tamperedPayload}.${parts[2]}`, SECRET, 1_001),
    ).toBeNull();

    const legacyPayload = Buffer.from(JSON.stringify({ sub: "hub-a", iat: 1_000 })).toString(
      "base64url",
    );
    expect(
      authenticatedHubId(`${parts[0]}.${legacyPayload}.${parts[2]}`, SECRET, 1_001),
    ).toBeNull();
  });

  it("returns the full claims and defaults to a 24 hour TTL", () => {
    const token = createHubToken("hub-a", SECRET, undefined, 1_000, 3);
    expect(authenticatedHubClaims(token, SECRET, 1_000)).toEqual({
      sub: "hub-a",
      iat: 1_000,
      exp: 1_000 + DEFAULT_TOKEN_TTL_SECONDS,
      ver: 3,
    });
    expect(DEFAULT_TOKEN_TTL_SECONDS).toBe(24 * 60 * 60);
  });

  it("enforces the expected auth version only when one is given", () => {
    const token = createHubToken("hub-a", SECRET, 60, 1_000, 2);
    expect(verifyHubToken(token, "hub-a", SECRET, 1_000)).toBe(true);
    expect(verifyHubToken(token, "hub-a", SECRET, 1_000, 2)).toBe(true);
    expect(verifyHubToken(token, "hub-a", SECRET, 1_000, 1)).toBe(false);
    expect(verifyHubToken(token, "hub-a", SECRET, 1_000, 3)).toBe(false);
    expect(verifyHubToken("garbage", "hub-a", SECRET, 1_000)).toBe(false);
  });

  it("tolerates at most 60 seconds of issuer clock skew", () => {
    expect(authenticatedHubId(createHubToken("hub-a", SECRET, 600, 1_060), SECRET, 1_000)).toBe(
      "hub-a",
    );
    expect(
      authenticatedHubId(createHubToken("hub-a", SECRET, 600, 1_061), SECRET, 1_000),
    ).toBeNull();
  });

  it("rejects tokens signed with a different secret", () => {
    const token = createHubToken("hub-a", "other-secret", 60, 1_000);
    expect(authenticatedHubId(token, SECRET, 1_000)).toBeNull();
  });

  it("rejects structurally malformed tokens", () => {
    const [header, payload, signature] = createHubToken("hub-a", SECRET, 60, 1_000).split(".");
    const otherHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    );
    for (const token of [
      "",
      `${header}.${payload}`,
      `${header}.${payload}.${signature}.extra`,
      `.${payload}.${signature}`,
      `${header}..${signature}`,
      `${header}.${payload}.`,
      `${otherHeader}.${payload}.${signature}`,
      `${header}.${payload}.${signature?.slice(0, -4)}`,
      `${header}.${payload}.${Buffer.alloc(32).toString("base64url")}`,
    ]) {
      expect(authenticatedHubId(token, SECRET, 1_000), token).toBeNull();
    }
  });

  it("rejects correctly signed payloads with invalid claims", () => {
    const valid = { sub: "hub-a", iat: 1_000, exp: 2_000, ver: 1 };
    expect(authenticatedHubId(signedToken(JSON.stringify(valid)), SECRET, 1_000)).toBe("hub-a");
    for (const payload of [
      "not json",
      "null",
      JSON.stringify({ ...valid, sub: 42 }),
      JSON.stringify({ ...valid, sub: "   " }),
      JSON.stringify({ ...valid, iat: "1000" }),
      JSON.stringify({ ...valid, iat: 1_000.5 }),
      JSON.stringify({ ...valid, exp: undefined }),
      JSON.stringify({ ...valid, ver: undefined }),
      JSON.stringify({ ...valid, ver: 0 }),
      JSON.stringify({ ...valid, ver: 1.5 }),
      JSON.stringify({ ...valid, exp: 1_000 }),
    ]) {
      expect(authenticatedHubId(signedToken(payload), SECRET, 1_000), payload).toBeNull();
    }
  });
});

describe("Relay transport receipts", () => {
  it("accepts only a receipt signed by its authenticated recipient", () => {
    const keyPair = generateKeyPairSync("ed25519");
    const jwk = keyPair.publicKey.export({ format: "jwk" });
    if (!jwk.x) throw new Error("Missing Ed25519 public key");
    const publicKey = Buffer.from(jwk.x, "base64url").toString("hex");
    const unsigned = {
      messageId: "envelope-1",
      recipientHubId: publicKey,
      status: "persisted" as const,
      timestamp: 1_000,
    };
    const receipt: TransportReceipt = {
      ...unsigned,
      signature: sign(
        null,
        Buffer.from(canonicalize(unsigned), "utf8"),
        keyPair.privateKey,
      ).toString("base64"),
    };

    expect(verifyTransportReceipt(receipt, publicKey)).toBe(true);
    expect(verifyTransportReceipt({ ...receipt, messageId: "tampered" }, publicKey)).toBe(false);
    expect(verifyTransportReceipt({ ...receipt, recipientHubId: "00".repeat(32) }, publicKey)).toBe(
      false,
    );
  });

  it("rejects receipts from other keys, malformed keys, and malformed signatures", () => {
    const recipient = ed25519Identity();
    const other = ed25519Identity();
    const unsigned = {
      messageId: "envelope-1",
      recipientHubId: recipient.publicKey,
      status: "persisted" as const,
      timestamp: 1_000,
    };
    const forged: TransportReceipt = {
      ...unsigned,
      signature: signCanonical(unsigned, other.privateKey),
    };
    expect(verifyTransportReceipt(forged, recipient.publicKey)).toBe(false);

    const garbled: TransportReceipt = { ...unsigned, signature: "not a signature" };
    expect(verifyTransportReceipt(garbled, recipient.publicKey)).toBe(false);

    const shortKey = recipient.publicKey.slice(0, 62);
    expect(
      verifyTransportReceipt(
        {
          ...forged,
          recipientHubId: shortKey,
          signature: signCanonical(unsigned, recipient.privateKey),
        },
        shortKey,
      ),
    ).toBe(false);

    const invalidPoint = "ff".repeat(32);
    const offCurve = { ...unsigned, recipientHubId: invalidPoint };
    expect(
      verifyTransportReceipt(
        { ...offCurve, signature: signCanonical(offCurve, recipient.privateKey) },
        invalidPoint,
      ),
    ).toBe(false);
  });
});
