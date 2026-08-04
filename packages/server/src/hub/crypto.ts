import _sodium from "libsodium-wrappers";
import { canonicalize } from "@agentlink/shared";

let initialized = false;

async function ensureInit() {
  if (!initialized) {
    await _sodium.ready;
    initialized = true;
  }
  return _sodium;
}

/**
 * Generate an Ed25519 keypair for Hub identity.
 * The public key (hex) serves as the Hub ID.
 */
export async function generateHubKeypair(): Promise<{
  publicKey: string;
  secretKey: string;
}> {
  const sodium = await ensureInit();
  const kp = sodium.crypto_sign_keypair();
  return {
    publicKey: sodium.to_hex(kp.publicKey),
    secretKey: sodium.to_hex(kp.privateKey),
  };
}

/**
 * Convert Ed25519 public key → X25519 public key for crypto_box encryption.
 */
export async function ed25519ToX25519PublicKey(
  ed25519PubHex: string,
): Promise<Uint8Array> {
  const sodium = await ensureInit();
  return sodium.crypto_sign_ed25519_pk_to_curve25519(
    sodium.from_hex(ed25519PubHex),
  );
}

/**
 * Convert Ed25519 secret key → X25519 secret key for crypto_box decryption.
 */
export async function ed25519ToX25519SecretKey(
  ed25519SecHex: string,
): Promise<Uint8Array> {
  const sodium = await ensureInit();
  return sodium.crypto_sign_ed25519_sk_to_curve25519(
    sodium.from_hex(ed25519SecHex),
  );
}

/**
 * Encrypt a payload for a recipient using their Ed25519 public key.
 *
 * Uses libsodium crypto_box (X25519+XSalsa20-Poly1305) under the hood.
 * The Relay cannot decrypt — only the recipient with their Ed25519 secret key can.
 */
export async function encryptPayload(
  payload: unknown,
  recipientEd25519PubHex: string,
  senderEd25519SecHex: string,
): Promise<{ ciphertext: string; nonce: string }> {
  const sodium = await ensureInit();
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const recipientX25519 = await ed25519ToX25519PublicKey(recipientEd25519PubHex);
  const senderX25519 = await ed25519ToX25519SecretKey(senderEd25519SecHex);
  const message = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = sodium.crypto_box_easy(
    message,
    nonce,
    recipientX25519,
    senderX25519,
  );
  return {
    ciphertext: sodium.to_base64(encrypted),
    nonce: sodium.to_base64(nonce),
  };
}

/**
 * Decrypt a received ciphertext from a sender.
 */
export async function decryptPayload<T = unknown>(
  ciphertext: string,
  nonce: string,
  senderEd25519PubHex: string,
  recipientEd25519SecHex: string,
): Promise<T> {
  const sodium = await ensureInit();
  const senderX25519 = await ed25519ToX25519PublicKey(senderEd25519PubHex);
  const recipientX25519 = await ed25519ToX25519SecretKey(recipientEd25519SecHex);
  const decrypted = sodium.crypto_box_open_easy(
    sodium.from_base64(ciphertext),
    sodium.from_base64(nonce),
    senderX25519,
    recipientX25519,
  );
  return JSON.parse(new TextDecoder().decode(decrypted)) as T;
}

/**
 * Sign data with Ed25519 private key.
 */
export async function signEnvelope(
  data: unknown,
  ed25519SecHex: string,
): Promise<string> {
  const sodium = await ensureInit();
  const sig = sodium.crypto_sign_detached(
    new TextEncoder().encode(canonicalize(data)),
    sodium.from_hex(ed25519SecHex),
  );
  return sodium.to_base64(sig);
}

/**
 * Verify an Ed25519 signature.
 */
export async function verifySignature(
  data: unknown,
  signature: string,
  ed25519PubHex: string,
): Promise<boolean> {
  const sodium = await ensureInit();
  return sodium.crypto_sign_verify_detached(
    sodium.from_base64(signature),
    new TextEncoder().encode(canonicalize(data)),
    sodium.from_hex(ed25519PubHex),
  );
}
