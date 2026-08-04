import { describe, expect, it } from "vitest";
import { GroupKeyManager } from "./group-crypto.js";

describe("GroupKeyManager", () => {
  it("generates keys and increments the version", () => {
    const manager = new GroupKeyManager();
    const first = manager.generateKey("conversation-1");
    const second = manager.rekey("conversation-1");

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(second.id).not.toBe(first.id);
    expect(second.key).not.toBe(first.key);
    expect(manager.getKey("conversation-1")).toEqual(second);
  });

  it("encrypts and decrypts a message", () => {
    const manager = new GroupKeyManager();
    manager.generateKey("conversation-1");

    const encrypted = manager.encryptMessage("conversation-1", "你好, group");

    expect(encrypted).not.toBeNull();
    expect(
      manager.decryptMessage(
        "conversation-1",
        encrypted!.ciphertext,
        encrypted!.nonce,
        encrypted!.keyId,
      ),
    ).toBe("你好, group");
  });

  it("cannot decrypt an old-key message after rekeying", () => {
    const manager = new GroupKeyManager();
    manager.generateKey("conversation-1");
    const encrypted = manager.encryptMessage("conversation-1", "old message")!;

    manager.rekey("conversation-1");

    expect(
      manager.decryptMessage(
        "conversation-1",
        encrypted.ciphertext,
        encrypted.nonce,
        encrypted.keyId,
      ),
    ).toBeNull();
  });

  it("returns null when no key exists", () => {
    const manager = new GroupKeyManager();

    expect(manager.encryptMessage("missing", "message")).toBeNull();
    expect(manager.decryptMessage("missing", "ciphertext", "nonce", "key-id")).toBeNull();
  });
});
