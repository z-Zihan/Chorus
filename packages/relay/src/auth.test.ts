import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalize, type TransportReceipt } from "@chorus/shared";
import { describe, expect, it } from "vitest";
import {
  authenticatedHubId,
  createHubToken,
  verifyHubToken,
  verifyTransportReceipt,
} from "./auth.js";

const SECRET = "relay-auth-test-secret";

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
});
