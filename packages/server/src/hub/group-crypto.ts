import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const GROUP_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;

export interface GroupKey {
  id: string;
  key: string;
  createdAt: number;
  version: number;
}

export interface CommittedGroupKey extends GroupKey {
  keyCommitment: string;
}

export function computeKeyCommitment(
  roomKey: string | Uint8Array,
  roomId: string,
  keyEpoch: number,
): string {
  if (!Number.isSafeInteger(keyEpoch) || keyEpoch < 0) {
    throw new RangeError("keyEpoch must be a non-negative safe integer");
  }
  const epoch = Buffer.allocUnsafe(8);
  epoch.writeBigUInt64BE(BigInt(keyEpoch));
  const message = Buffer.concat([Buffer.from(roomId, "utf8"), epoch]);
  return createHmac("sha256", roomKey).update(message).digest("hex");
}

export function verifyKeyCommitment(
  roomKey: string | Uint8Array,
  roomId: string,
  keyEpoch: number,
  commitment: string,
): boolean {
  if (!/^[0-9a-fA-F]{64}$/.test(commitment)) return false;
  try {
    const expected = Buffer.from(computeKeyCommitment(roomKey, roomId, keyEpoch), "hex");
    const received = Buffer.from(commitment, "hex");
    return timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

export interface EncryptedGroupKey {
  keyId: string;
  version: number;
  recipients: Array<{
    hubId: string;
    encryptedKey: string;
  }>;
}

/** In-memory group key state for cross-Hub conversations. */
export class GroupKeyManager {
  private readonly groupKeys = new Map<string, GroupKey>();

  /** Generate a new group key for a conversation. */
  generateKey(conversationId: string): GroupKey {
    const current = this.groupKeys.get(conversationId);
    const groupKey: GroupKey = {
      id: `gk_${randomBytes(8).toString("base64url")}`,
      key: randomBytes(GROUP_KEY_BYTES).toString("base64url"),
      createdAt: Date.now(),
      version: (current?.version ?? 0) + 1,
    };
    this.groupKeys.set(conversationId, groupKey);
    return groupKey;
  }

  /** Install a key received from another group member. Stale keys are ignored. */
  setKey(conversationId: string, groupKey: GroupKey): boolean {
    if (!isValidGroupKey(groupKey)) return false;
    const current = this.groupKeys.get(conversationId);
    if (current && groupKey.version <= current.version) return false;
    this.groupKeys.set(conversationId, { ...groupKey });
    return true;
  }

  /** Get the current group key. */
  getKey(conversationId: string): GroupKey | undefined {
    return this.groupKeys.get(conversationId);
  }

  /** Rekey when membership changes. */
  rekey(conversationId: string): CommittedGroupKey {
    const groupKey = this.generateKey(conversationId);
    return {
      ...groupKey,
      keyCommitment: computeKeyCommitment(
        Buffer.from(groupKey.key, "base64url"),
        conversationId,
        groupKey.version,
      ),
    };
  }

  /** Install a rekey only after validating its commitment. */
  installRekey(conversationId: string, groupKey: GroupKey, keyCommitment: string): boolean {
    if (
      !verifyKeyCommitment(
        Buffer.from(groupKey.key, "base64url"),
        conversationId,
        groupKey.version,
        keyCommitment,
      )
    ) {
      return false;
    }
    return this.setKey(conversationId, groupKey);
  }

  /** Encrypt a message with the current group key using AES-256-GCM. */
  encryptMessage(
    conversationId: string,
    plaintext: string,
  ): {
    ciphertext: string;
    nonce: string;
    keyId: string;
    keyEpoch: number;
    keyCommitment: string;
  } | null {
    const groupKey = this.getKey(conversationId);
    if (!groupKey) return null;

    const nonce = randomBytes(GCM_NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(groupKey.key, "base64url"), nonce);
    cipher.setAAD(Buffer.from(groupKey.id, "utf8"));
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const ciphertext = Buffer.concat([encrypted, cipher.getAuthTag()]);
    return {
      ciphertext: ciphertext.toString("base64url"),
      nonce: nonce.toString("base64url"),
      keyId: groupKey.id,
      keyEpoch: groupKey.version,
      keyCommitment: computeKeyCommitment(
        Buffer.from(groupKey.key, "base64url"),
        conversationId,
        groupKey.version,
      ),
    };
  }

  /** Decrypt a message only when it uses the current group key. */
  decryptMessage(
    conversationId: string,
    ciphertext: string,
    nonce: string,
    keyId: string,
  ): string | null {
    const groupKey = this.getKey(conversationId);
    if (!groupKey || groupKey.id !== keyId) return null;

    try {
      const encrypted = Buffer.from(ciphertext, "base64url");
      if (encrypted.length < GCM_TAG_BYTES) return null;
      const body = encrypted.subarray(0, -GCM_TAG_BYTES);
      const tag = encrypted.subarray(-GCM_TAG_BYTES);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        Buffer.from(groupKey.key, "base64url"),
        Buffer.from(nonce, "base64url"),
      );
      decipher.setAAD(Buffer.from(groupKey.id, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    } catch {
      return null;
    }
  }
}

function isValidGroupKey(groupKey: GroupKey): boolean {
  if (
    !groupKey.id.startsWith("gk_") ||
    !Number.isInteger(groupKey.version) ||
    groupKey.version < 1 ||
    !Number.isFinite(groupKey.createdAt)
  ) {
    return false;
  }
  try {
    return Buffer.from(groupKey.key, "base64url").length === GROUP_KEY_BYTES;
  } catch {
    return false;
  }
}
