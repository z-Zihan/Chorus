import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getHubKey, setHubKey, type HubKeypair } from "../credential-store.js";
import { generateHubKeypair } from "./crypto.js";

interface HubKeypairFile extends Record<string, unknown> {
  publicKey?: unknown;
  secretKey?: unknown;
}

/**
 * Hub identity manager.
 *
 * Generates and persists an Ed25519 keypair on first launch.
 * The public key (hex) serves as the unique Hub ID.
 */
export class HubIdentity {
  private publicKey: string | null = null;
  private initialization: Promise<HubKeypair> | null = null;

  constructor(private readonly keypairPath: string) {}

  /**
   * Load the keypair from credential storage, migrate a legacy keypair file,
   * or generate a new one. Only the public key remains in the JSON file.
   */
  async getOrCreateKeypair(): Promise<HubKeypair> {
    if (this.publicKey) return this.readStoredKey();
    if (!this.initialization) this.initialization = this.initialize();

    try {
      return await this.initialization;
    } catch (error) {
      this.initialization = null;
      throw error;
    }
  }

  /** Full Hub ID = Ed25519 public key hex */
  get hubId(): string {
    if (!this.publicKey) throw new Error("Hub identity not initialized — call getOrCreateKeypair() first");
    return this.publicKey;
  }

  /** SHA-256 fingerprint of the raw Ed25519 public key, truncated to 128 bits. */
  getFingerprint(): string {
    return createHash("sha256")
      .update(Buffer.from(this.hubId, "hex"))
      .digest("hex")
      .slice(0, 32);
  }

  getPublicKey(): string {
    return this.hubId;
  }

  /** Read the Ed25519 secret key hex from credential storage. */
  async getSecretKey(): Promise<string> {
    return (await this.readStoredKey()).secretKey;
  }

  private async initialize(): Promise<HubKeypair> {
    const file = await this.readKeypairFile();
    let key = await getHubKey();

    if (!key && isLegacyKeypair(file)) {
      key = { publicKey: file.publicKey, secretKey: file.secretKey };
    }
    if (!key) key = await generateHubKeypair();

    await setHubKey(key);
    await this.writePublicKeyFile(file, key.publicKey);
    this.publicKey = key.publicKey;
    return key;
  }

  private async readStoredKey(): Promise<HubKeypair> {
    if (!this.publicKey) {
      throw new Error("Hub identity not initialized — call getOrCreateKeypair() first");
    }
    const key = await getHubKey();
    if (!key) throw new Error("Hub key is missing from credential storage");
    if (key.publicKey !== this.publicKey) {
      throw new Error("Stored Hub key does not match the initialized Hub identity");
    }
    return key;
  }

  private async readKeypairFile(): Promise<HubKeypairFile | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.keypairPath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Hub keypair file must contain a JSON object");
      }
      return parsed as HubKeypairFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async writePublicKeyFile(file: HubKeypairFile | null, publicKey: string): Promise<void> {
    const { secretKey: _secretKey, publicKey: _publicKey, ...metadata } = file ?? {};
    const contents = JSON.stringify({ publicKey, ...metadata }, null, 2);
    const directory = dirname(this.keypairPath);
    const temporaryPath = `${this.keypairPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;

    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.keypairPath);
  }
}

function isLegacyKeypair(file: HubKeypairFile | null): file is HubKeypairFile & HubKeypair {
  return typeof file?.publicKey === "string" && typeof file.secretKey === "string";
}
