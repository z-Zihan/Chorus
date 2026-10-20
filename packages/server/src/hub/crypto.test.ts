import _sodium from "libsodium-wrappers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  decryptPayload,
  ed25519ToX25519PublicKey,
  ed25519ToX25519SecretKey,
  encryptPayload,
  generateHubKeypair,
  signEnvelope,
  verifySignature,
} from "./crypto.js";

let sodium: typeof _sodium;

beforeAll(async () => {
  await _sodium.ready;
  sodium = _sodium;
});

describe("generateHubKeypair", () => {
  it("returns hex-encoded Ed25519 public/secret keys of the expected length", async () => {
    const { publicKey, secretKey } = await generateHubKeypair();

    expect(publicKey).toMatch(/^[0-9a-f]{64}$/u);
    expect(secretKey).toMatch(/^[0-9a-f]{128}$/u);
  });

  it("generates different keys on each call", async () => {
    const first = await generateHubKeypair();
    const second = await generateHubKeypair();

    expect(first.publicKey).not.toBe(second.publicKey);
    expect(first.secretKey).not.toBe(second.secretKey);
  });
});

describe("ed25519ToX25519PublicKey / ed25519ToX25519SecretKey", () => {
  it("convert a real Ed25519 keypair into an X25519 keypair usable by crypto_box", async () => {
    const alice = await generateHubKeypair();
    const bob = await generateHubKeypair();

    const aliceCurveSecret = await ed25519ToX25519SecretKey(alice.secretKey);
    const bobCurvePublic = await ed25519ToX25519PublicKey(bob.publicKey);
    const bobCurveSecret = await ed25519ToX25519SecretKey(bob.secretKey);
    const aliceCurvePublic = await ed25519ToX25519PublicKey(alice.publicKey);

    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const message = new TextEncoder().encode("hello from alice");
    const boxed = sodium.crypto_box_easy(message, nonce, bobCurvePublic, aliceCurveSecret);
    const opened = sodium.crypto_box_open_easy(boxed, nonce, aliceCurvePublic, bobCurveSecret);

    expect(new TextDecoder().decode(opened)).toBe("hello from alice");
  });

  it("produces keys that do not interoperate with an unrelated Hub's converted keys", async () => {
    const alice = await generateHubKeypair();
    const bob = await generateHubKeypair();
    const mallory = await generateHubKeypair();

    const aliceCurveSecret = await ed25519ToX25519SecretKey(alice.secretKey);
    const bobCurvePublic = await ed25519ToX25519PublicKey(bob.publicKey);
    const malloryCurveSecret = await ed25519ToX25519SecretKey(mallory.secretKey);

    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const message = new TextEncoder().encode("secret");
    const boxed = sodium.crypto_box_easy(message, nonce, bobCurvePublic, aliceCurveSecret);
    const aliceCurvePublic = await ed25519ToX25519PublicKey(alice.publicKey);

    expect(() =>
      sodium.crypto_box_open_easy(boxed, nonce, aliceCurvePublic, malloryCurveSecret),
    ).toThrow();
  });
});

describe("encryptPayload / decryptPayload", () => {
  it("round-trips a payload between a real sender and recipient keypair", async () => {
    const sender = await generateHubKeypair();
    const recipient = await generateHubKeypair();
    const payload = { kind: "ping", seq: 1 };

    const { ciphertext, nonce } = await encryptPayload(
      payload,
      recipient.publicKey,
      sender.secretKey,
    );
    const decrypted = await decryptPayload(
      ciphertext,
      nonce,
      sender.publicKey,
      recipient.secretKey,
    );

    expect(decrypted).toEqual(payload);
  });

  it("round-trips a deeply nested payload", async () => {
    const sender = await generateHubKeypair();
    const recipient = await generateHubKeypair();
    const payload = {
      foo: { bar: [1, "two", { three: 3 }] },
      list: [{ a: 1 }, { a: 2 }],
      nil: null,
    };

    const { ciphertext, nonce } = await encryptPayload(
      payload,
      recipient.publicKey,
      sender.secretKey,
    );
    const decrypted = await decryptPayload(
      ciphertext,
      nonce,
      sender.publicKey,
      recipient.secretKey,
    );

    expect(decrypted).toEqual(payload);
  });

  it("drops undefined-valued keys the same way JSON.stringify does", async () => {
    const sender = await generateHubKeypair();
    const recipient = await generateHubKeypair();
    const payload = { a: 1, b: undefined };

    const { ciphertext, nonce } = await encryptPayload(
      payload,
      recipient.publicKey,
      sender.secretKey,
    );
    const decrypted = await decryptPayload(
      ciphertext,
      nonce,
      sender.publicKey,
      recipient.secretKey,
    );

    expect(decrypted).toEqual({ a: 1 });
  });

  it("fails to decrypt with the wrong recipient secret key", async () => {
    const sender = await generateHubKeypair();
    const recipient = await generateHubKeypair();
    const stranger = await generateHubKeypair();
    const payload = { kind: "ping" };

    const { ciphertext, nonce } = await encryptPayload(
      payload,
      recipient.publicKey,
      sender.secretKey,
    );

    await expect(
      decryptPayload(ciphertext, nonce, sender.publicKey, stranger.secretKey),
    ).rejects.toThrow();
  });

  it("fails to decrypt when the ciphertext has been tampered with", async () => {
    const sender = await generateHubKeypair();
    const recipient = await generateHubKeypair();
    const payload = { kind: "ping" };

    const { ciphertext, nonce } = await encryptPayload(
      payload,
      recipient.publicKey,
      sender.secretKey,
    );
    const tamperedBytes = sodium.from_base64(ciphertext);
    tamperedBytes[0] = (tamperedBytes[0] ?? 0) ^ 0xff;
    const tamperedCiphertext = sodium.to_base64(tamperedBytes);

    await expect(
      decryptPayload(tamperedCiphertext, nonce, sender.publicKey, recipient.secretKey),
    ).rejects.toThrow();
  });

  it("fails to decrypt when the nonce has been tampered with", async () => {
    const sender = await generateHubKeypair();
    const recipient = await generateHubKeypair();
    const payload = { kind: "ping" };

    const { ciphertext, nonce } = await encryptPayload(
      payload,
      recipient.publicKey,
      sender.secretKey,
    );
    const tamperedNonceBytes = sodium.from_base64(nonce);
    tamperedNonceBytes[0] = (tamperedNonceBytes[0] ?? 0) ^ 0xff;
    const tamperedNonce = sodium.to_base64(tamperedNonceBytes);

    await expect(
      decryptPayload(ciphertext, tamperedNonce, sender.publicKey, recipient.secretKey),
    ).rejects.toThrow();
  });
});

describe("signEnvelope / verifySignature", () => {
  it("verifies a signature made by the matching secret key", async () => {
    const { publicKey, secretKey } = await generateHubKeypair();
    const data = { messageType: "resync_request", roomId: "room-1" };

    const signature = await signEnvelope(data, secretKey);

    expect(await verifySignature(data, signature, publicKey)).toBe(true);
  });

  it("rejects a signature verified against an unrelated public key", async () => {
    const { secretKey } = await generateHubKeypair();
    const other = await generateHubKeypair();
    const data = { messageType: "resync_request", roomId: "room-1" };

    const signature = await signEnvelope(data, secretKey);

    expect(await verifySignature(data, signature, other.publicKey)).toBe(false);
  });

  it("rejects when the signed data is mutated after signing", async () => {
    const { publicKey, secretKey } = await generateHubKeypair();
    const data = { messageType: "resync_request", roomId: "room-1" };

    const signature = await signEnvelope(data, secretKey);

    expect(await verifySignature({ ...data, roomId: "room-2" }, signature, publicKey)).toBe(false);
  });
});
