import { describe, expect, it } from "vitest";
import { generateUserKeyPair } from "../identity/user-keys.js";
import {
  createOwnerProof,
  isOwnerProof,
  verifyOwnerProof,
  type OwnerProof,
} from "./owner-proof.js";

describe("createOwnerProof", () => {
  it("preserves the claims fields as-is and produces a verifiable signature", () => {
    const owner = generateUserKeyPair();

    const proof = createOwnerProof("agent-1", "usr_owner", "room-1", 3, owner.privateKey);

    expect(proof.agentId).toBe("agent-1");
    expect(proof.ownerId).toBe("usr_owner");
    expect(proof.roomId).toBe("room-1");
    expect(proof.keyEpoch).toBe(3);
    expect(typeof proof.signature).toBe("string");
    expect(proof.signature.length).toBeGreaterThan(0);
    expect(verifyOwnerProof(proof, owner.publicKey)).toBe(true);
  });

  it("produces different signatures for different claims, even with the same key", () => {
    const owner = generateUserKeyPair();

    const first = createOwnerProof("agent-1", "usr_owner", "room-1", 1, owner.privateKey);
    const second = createOwnerProof("agent-2", "usr_owner", "room-1", 1, owner.privateKey);

    expect(first.signature).not.toBe(second.signature);
  });
});

describe("verifyOwnerProof", () => {
  it("accepts a proof verified with the matching public key", () => {
    const owner = generateUserKeyPair();
    const proof = createOwnerProof("agent-1", "usr_owner", "room-1", 1, owner.privateKey);

    expect(verifyOwnerProof(proof, owner.publicKey)).toBe(true);
  });

  it("rejects when verified against a different owner's public key", () => {
    const owner = generateUserKeyPair();
    const impostor = generateUserKeyPair();
    const proof = createOwnerProof("agent-1", "usr_owner", "room-1", 1, owner.privateKey);

    expect(verifyOwnerProof(proof, impostor.publicKey)).toBe(false);
  });

  it.each(["agentId", "ownerId", "roomId"] as const)(
    "rejects when the %s claim is tampered with after signing",
    (field) => {
      const owner = generateUserKeyPair();
      const proof = createOwnerProof("agent-1", "usr_owner", "room-1", 1, owner.privateKey);
      const tampered: OwnerProof = { ...proof, [field]: `${proof[field]}-tampered` };

      expect(verifyOwnerProof(tampered, owner.publicKey)).toBe(false);
    },
  );

  it("rejects when the keyEpoch claim is tampered with after signing", () => {
    const owner = generateUserKeyPair();
    const proof = createOwnerProof("agent-1", "usr_owner", "room-1", 1, owner.privateKey);
    const tampered: OwnerProof = { ...proof, keyEpoch: 2 };

    expect(verifyOwnerProof(tampered, owner.publicKey)).toBe(false);
  });

  it("accepts a proof from any key epoch when currentKeyEpoch is not supplied", () => {
    const owner = generateUserKeyPair();
    const proof = createOwnerProof("agent-1", "usr_owner", "room-1", 7, owner.privateKey);

    expect(verifyOwnerProof(proof, owner.publicKey)).toBe(true);
  });

  it("accepts a proof whose keyEpoch matches currentKeyEpoch", () => {
    const owner = generateUserKeyPair();
    const proof = createOwnerProof("agent-1", "usr_owner", "room-1", 2, owner.privateKey);

    expect(verifyOwnerProof(proof, owner.publicKey, 2)).toBe(true);
  });

  it("rejects a proof whose keyEpoch does not match currentKeyEpoch, without checking the signature", () => {
    const owner = generateUserKeyPair();
    const proof = createOwnerProof("agent-1", "usr_owner", "room-1", 1, owner.privateKey);

    expect(verifyOwnerProof(proof, owner.publicKey, 2)).toBe(false);
  });

  it("returns false rather than throwing for a malformed public key", () => {
    const owner = generateUserKeyPair();
    const proof = createOwnerProof("agent-1", "usr_owner", "room-1", 1, owner.privateKey);

    expect(() => verifyOwnerProof(proof, "not-valid-hex")).not.toThrow();
    expect(verifyOwnerProof(proof, "not-valid-hex")).toBe(false);
  });

  it("returns false rather than throwing for a malformed signature", () => {
    const owner = generateUserKeyPair();
    const proof = createOwnerProof("agent-1", "usr_owner", "room-1", 1, owner.privateKey);
    const tampered: OwnerProof = { ...proof, signature: "not-valid-base64!!" };

    expect(() => verifyOwnerProof(tampered, owner.publicKey)).not.toThrow();
    expect(verifyOwnerProof(tampered, owner.publicKey)).toBe(false);
  });

  it("returns false rather than throwing for claims that fail validation (empty agentId)", () => {
    const owner = generateUserKeyPair();
    const proof = createOwnerProof("agent-1", "usr_owner", "room-1", 1, owner.privateKey);
    const malformed: OwnerProof = { ...proof, agentId: "" };

    expect(() => verifyOwnerProof(malformed, owner.publicKey)).not.toThrow();
    expect(verifyOwnerProof(malformed, owner.publicKey)).toBe(false);
  });

  it("returns false rather than throwing for a keyEpoch below 1", () => {
    const owner = generateUserKeyPair();
    const proof = createOwnerProof("agent-1", "usr_owner", "room-1", 1, owner.privateKey);
    const malformed: OwnerProof = { ...proof, keyEpoch: 0 };

    expect(verifyOwnerProof(malformed, owner.publicKey)).toBe(false);
  });
});

describe("isOwnerProof", () => {
  it("accepts a well-formed OwnerProof", () => {
    const owner = generateUserKeyPair();
    const proof = createOwnerProof("agent-1", "usr_owner", "room-1", 1, owner.privateKey);

    expect(isOwnerProof(proof)).toBe(true);
  });

  it.each([
    [null],
    [undefined],
    ["a string"],
    [{}],
    [{ agentId: "a", ownerId: "o", roomId: "r", keyEpoch: 1, signature: "" }],
    [{ agentId: "a", ownerId: "o", roomId: "r", keyEpoch: 0, signature: "sig" }],
    [{ agentId: "a", ownerId: "o", roomId: "r", keyEpoch: 1.5, signature: "sig" }],
    [{ agentId: "", ownerId: "o", roomId: "r", keyEpoch: 1, signature: "sig" }],
  ])("rejects malformed value %#", (value) => {
    expect(isOwnerProof(value)).toBe(false);
  });
});
