import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generateHubKeypair } from "./crypto";

export interface HubKeypair {
  publicKey: string;
  secretKey: string;
}

/**
 * Hub identity manager.
 *
 * Generates and persists an Ed25519 keypair on first launch.
 * The public key (hex) serves as the unique Hub ID.
 */
export class HubIdentity {
  private keypair: HubKeypair | null = null;

  constructor(private readonly keypairPath: string) {}

  /**
   * Load existing keypair or generate a new one.
   * The keypair is stored as JSON with file mode 0600.
   */
  async getOrCreateKeypair(): Promise<HubKeypair> {
    if (this.keypair) return this.keypair;

    if (existsSync(this.keypairPath)) {
      const raw = JSON.parse(readFileSync(this.keypairPath, "utf-8")) as HubKeypair;
      this.keypair = { publicKey: raw.publicKey, secretKey: raw.secretKey };
    } else {
      this.keypair = await generateHubKeypair();
      mkdirSync(dirname(this.keypairPath), { recursive: true });
      writeFileSync(this.keypairPath, JSON.stringify(this.keypair, null, 2), {
        mode: 0o600,
      });
    }

    return this.keypair;
  }

  /** Full Hub ID = Ed25519 public key hex */
  get hubId(): string {
    if (!this.keypair) throw new Error("Hub identity not initialized — call getOrCreateKeypair() first");
    return this.keypair.publicKey;
  }

  /** Short display ID = first 8 chars of Hub ID */
  get shortId(): string {
    return this.hubId.slice(0, 8);
  }

  /** Ed25519 secret key hex (for signing + decryption) */
  get secretKey(): string {
    if (!this.keypair) throw new Error("Hub identity not initialized — call getOrCreateKeypair() first");
    return this.keypair.secretKey;
  }
}
