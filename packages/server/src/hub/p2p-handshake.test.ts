import { describe, expect, it } from "vitest";
import { generateHubKeypair } from "./crypto.js";
import { P2PHandshake } from "./p2p-handshake.js";

describe("P2PHandshake", () => {
  describe("createChallenge", () => {
    it("returns a base64-decodable 32-byte nonce", () => {
      const handshake = new P2PHandshake();
      const nonce = handshake.createChallenge();

      expect(Buffer.from(nonce, "base64")).toHaveLength(32);
    });

    it("returns a different nonce on each call", () => {
      const handshake = new P2PHandshake();

      expect(handshake.createChallenge()).not.toBe(handshake.createChallenge());
    });
  });

  describe("signChallenge / verifyChallenge round-trip", () => {
    it("verifies true for a signature produced by the matching secret key", async () => {
      const handshake = new P2PHandshake();
      const { publicKey, secretKey } = await generateHubKeypair();
      const nonce = handshake.createChallenge();

      const signature = await handshake.signChallenge(nonce, secretKey);

      expect(await handshake.verifyChallenge(nonce, signature, publicKey)).toBe(true);
    });

    it("returns false for a signature verified against an unrelated public key", async () => {
      const handshake = new P2PHandshake();
      const signer = await generateHubKeypair();
      const other = await generateHubKeypair();
      const nonce = handshake.createChallenge();

      const signature = await handshake.signChallenge(nonce, signer.secretKey);

      expect(await handshake.verifyChallenge(nonce, signature, other.publicKey)).toBe(false);
    });

    it("returns false when the nonce being verified does not match the signed nonce", async () => {
      const handshake = new P2PHandshake();
      const { publicKey, secretKey } = await generateHubKeypair();
      const signedNonce = handshake.createChallenge();
      const tamperedNonce = handshake.createChallenge();

      const signature = await handshake.signChallenge(signedNonce, secretKey);

      expect(await handshake.verifyChallenge(tamperedNonce, signature, publicKey)).toBe(false);
    });

    it("returns false without throwing for a malformed signature", async () => {
      const handshake = new P2PHandshake();
      const { publicKey } = await generateHubKeypair();
      const nonce = handshake.createChallenge();

      await expect(
        handshake.verifyChallenge(nonce, "not-valid-base64-!!!", publicKey),
      ).resolves.toBe(false);
      await expect(handshake.verifyChallenge(nonce, "", publicKey)).resolves.toBe(false);
      await expect(
        handshake.verifyChallenge(nonce, Buffer.from("short").toString("base64"), publicKey),
      ).resolves.toBe(false);
    });

    it("returns false without throwing for a malformed public key", async () => {
      const handshake = new P2PHandshake();
      const { secretKey } = await generateHubKeypair();
      const nonce = handshake.createChallenge();
      const signature = await handshake.signChallenge(nonce, secretKey);

      await expect(handshake.verifyChallenge(nonce, signature, "not-a-hex-key")).resolves.toBe(
        false,
      );
      await expect(handshake.verifyChallenge(nonce, signature, "")).resolves.toBe(false);
    });

    // signChallenge is a direct passthrough to signEnvelope with no try/catch
    // around it, so an invalid secret key rejects the returned promise rather
    // than resolving to an error value. Documenting actual behavior, not a bug.
    it("rejects (does not resolve) when signing with a malformed secret key", async () => {
      const handshake = new P2PHandshake();
      const nonce = handshake.createChallenge();

      await expect(handshake.signChallenge(nonce, "not-a-valid-secret-key")).rejects.toThrow();
    });
  });
});
