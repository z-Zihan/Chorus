import { signData, verifySignature } from "../identity/user-keys.js";

export interface OwnerProof {
  agentId: string;
  ownerId: string;
  roomId: string;
  keyEpoch: number;
  signature: string;
}

type OwnerProofClaims = Omit<OwnerProof, "signature">;

/** Sign the canonical RFC 8785 representation of an Agent's Room ownership claims. */
export function createOwnerProof(
  agentId: string,
  ownerId: string,
  roomId: string,
  keyEpoch: number,
  privateKey: string,
): OwnerProof {
  const claims = ownerProofClaims({ agentId, ownerId, roomId, keyEpoch });
  return { ...claims, signature: signData(privateKey, claims) };
}

/**
 * Verify an OwnerProof. When the Room's current epoch is supplied, proofs from
 * older (or future) epochs are rejected before their signature is considered.
 */
export function verifyOwnerProof(
  proof: OwnerProof,
  publicKey: string,
  currentKeyEpoch?: number,
): boolean {
  try {
    const claims = ownerProofClaims(proof);
    if (currentKeyEpoch !== undefined && claims.keyEpoch !== currentKeyEpoch) return false;
    return verifySignature(publicKey, claims, proof.signature);
  } catch {
    return false;
  }
}

export function isOwnerProof(value: unknown): value is OwnerProof {
  if (!value || typeof value !== "object") return false;
  const proof = value as Partial<OwnerProof>;
  return (
    typeof proof.agentId === "string" &&
    proof.agentId.length > 0 &&
    typeof proof.ownerId === "string" &&
    proof.ownerId.length > 0 &&
    typeof proof.roomId === "string" &&
    proof.roomId.length > 0 &&
    Number.isSafeInteger(proof.keyEpoch) &&
    (proof.keyEpoch ?? 0) >= 1 &&
    typeof proof.signature === "string" &&
    proof.signature.length > 0
  );
}

function ownerProofClaims(value: OwnerProofClaims): OwnerProofClaims {
  if (
    !value.agentId ||
    !value.ownerId ||
    !value.roomId ||
    !Number.isSafeInteger(value.keyEpoch) ||
    value.keyEpoch < 1
  ) {
    throw new Error("OwnerProof claims are invalid");
  }
  return {
    agentId: value.agentId,
    ownerId: value.ownerId,
    roomId: value.roomId,
    keyEpoch: value.keyEpoch,
  };
}
