import { randomBytes } from "node:crypto";
import { signEnvelope, verifySignature } from "./crypto.js";

export class P2PHandshake {
  createChallenge(): string {
    return randomBytes(32).toString("base64");
  }

  async verifyChallenge(
    nonce: string,
    signature: string,
    publicKey: string,
  ): Promise<boolean> {
    try {
      return await verifySignature(nonce, signature, publicKey);
    } catch {
      return false;
    }
  }

  signChallenge(nonce: string, secretKey: string): Promise<string> {
    return signEnvelope(nonce, secretKey);
  }
}
