import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { canonicalize } from "@chorus/shared";

export interface UserKeyPair {
  publicKey: string;
  privateKey: string;
}

export function generateUserKeyPair(): UserKeyPair {
  const keyPair = generateKeyPairSync("ed25519");
  const publicJwk = keyPair.publicKey.export({ format: "jwk" });
  if (!publicJwk.x) throw new Error("Generated Ed25519 public key is missing key material");

  return {
    publicKey: Buffer.from(publicJwk.x, "base64url").toString("hex"),
    privateKey: keyPair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  };
}

export function deriveUserId(publicKey: string): string {
  const publicKeyBytes = decodePublicKey(publicKey);
  return `usr_${createHash("sha256").update(publicKeyBytes).digest("hex").slice(0, 32)}`;
}

export function signData(privateKey: string, data: unknown): string {
  const key = createPrivateKey({
    key: Buffer.from(privateKey, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return sign(null, Buffer.from(canonicalize(data), "utf8"), key).toString("base64");
}

export function verifySignature(publicKey: string, data: unknown, signature: string): boolean {
  try {
    const publicKeyBytes = decodePublicKey(publicKey);
    const key = createPublicKey({
      key: {
        kty: "OKP",
        crv: "Ed25519",
        x: publicKeyBytes.toString("base64url"),
      },
      format: "jwk",
    });
    return verify(
      null,
      Buffer.from(canonicalize(data), "utf8"),
      key,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

function decodePublicKey(publicKey: string): Buffer {
  if (!/^[0-9a-f]{64}$/iu.test(publicKey)) {
    throw new Error("Ed25519 public key must be a 32-byte hex string");
  }
  return Buffer.from(publicKey, "hex");
}
