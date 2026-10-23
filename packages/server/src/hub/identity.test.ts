import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../credential-store.js", () => ({
  getHubKey: vi.fn(),
  setHubKey: vi.fn(),
}));

import { getHubKey, setHubKey } from "../credential-store.js";
import { generateHubKeypair } from "./crypto.js";
import { HubIdentity } from "./identity.js";

const mockedGetHubKey = vi.mocked(getHubKey);
const mockedSetHubKey = vi.mocked(setHubKey);

let directory: string;
let keypairPath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "chorus-identity-test-"));
  keypairPath = join(directory, "hub-keypair.json");
  mockedGetHubKey.mockReset();
  mockedSetHubKey.mockReset();
  mockedGetHubKey.mockResolvedValue(null);
  mockedSetHubKey.mockResolvedValue(undefined);
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("getOrCreateKeypair", () => {
  it("generates a new keypair when none is stored and no file exists", async () => {
    const identity = new HubIdentity(keypairPath);
    const key = await identity.getOrCreateKeypair();

    expect(key.publicKey).toMatch(/^[0-9a-f]{64}$/u);
    expect(key.secretKey).toMatch(/^[0-9a-f]{128}$/u);
    expect(mockedSetHubKey).toHaveBeenCalledTimes(1);
    expect(mockedSetHubKey).toHaveBeenCalledWith(key);

    const fileContents = JSON.parse(readFileSync(keypairPath, "utf8"));
    expect(fileContents).toEqual({ publicKey: key.publicKey });
  });

  it("migrates a legacy keypair file (publicKey + secretKey) when no key is stored", async () => {
    const legacyKey = await generateHubKeypair();
    writeFileSync(
      keypairPath,
      JSON.stringify({
        publicKey: legacyKey.publicKey,
        secretKey: legacyKey.secretKey,
        createdAt: "2020-01-01T00:00:00.000Z",
        extra: "metadata",
      }),
    );

    const identity = new HubIdentity(keypairPath);
    const key = await identity.getOrCreateKeypair();

    expect(key).toEqual(legacyKey);
    expect(mockedSetHubKey).toHaveBeenCalledTimes(1);
    expect(mockedSetHubKey).toHaveBeenCalledWith(legacyKey);

    const fileContents = JSON.parse(readFileSync(keypairPath, "utf8"));
    expect(fileContents).toEqual({
      publicKey: legacyKey.publicKey,
      createdAt: "2020-01-01T00:00:00.000Z",
      extra: "metadata",
    });
    expect(fileContents.secretKey).toBeUndefined();
  });

  it("uses the key already in credential storage instead of generating one", async () => {
    const storedKey = await generateHubKeypair();
    mockedGetHubKey.mockResolvedValue(storedKey);

    const identity = new HubIdentity(keypairPath);
    const key = await identity.getOrCreateKeypair();

    expect(key).toEqual(storedKey);
    expect(mockedSetHubKey).toHaveBeenCalledTimes(1);
    expect(mockedSetHubKey).toHaveBeenCalledWith(storedKey);

    const fileContents = JSON.parse(readFileSync(keypairPath, "utf8"));
    expect(fileContents).toEqual({ publicKey: storedKey.publicKey });
  });

  it("initializes only once under concurrent calls and returns the same key to both callers", async () => {
    const identity = new HubIdentity(keypairPath);

    const [first, second] = await Promise.all([
      identity.getOrCreateKeypair(),
      identity.getOrCreateKeypair(),
    ]);

    expect(first).toEqual(second);
    expect(mockedSetHubKey).toHaveBeenCalledTimes(1);
  });

  it("resets initialization state on failure so a later call retries and succeeds", async () => {
    mockedSetHubKey.mockRejectedValueOnce(new Error("store unavailable"));
    const identity = new HubIdentity(keypairPath);

    await expect(identity.getOrCreateKeypair()).rejects.toThrow("store unavailable");

    const key = await identity.getOrCreateKeypair();
    expect(key.publicKey).toMatch(/^[0-9a-f]{64}$/u);
    expect(mockedSetHubKey).toHaveBeenCalledTimes(2);
  });
});

describe("corrupt keypair file", () => {
  it("propagates a JSON parse error without overwriting the file", async () => {
    const contents = "{not valid json";
    writeFileSync(keypairPath, contents);
    const identity = new HubIdentity(keypairPath);

    await expect(identity.getOrCreateKeypair()).rejects.toThrow();

    expect(readFileSync(keypairPath, "utf8")).toBe(contents);
    expect(mockedSetHubKey).not.toHaveBeenCalled();
  });

  it("rejects a JSON array with 'must contain a JSON object' and does not overwrite the file", async () => {
    const contents = "[1,2,3]";
    writeFileSync(keypairPath, contents);
    const identity = new HubIdentity(keypairPath);

    await expect(identity.getOrCreateKeypair()).rejects.toThrow(
      "Hub keypair file must contain a JSON object",
    );

    expect(readFileSync(keypairPath, "utf8")).toBe(contents);
    expect(mockedSetHubKey).not.toHaveBeenCalled();
  });

  it("rejects a bare JSON string with 'must contain a JSON object' and does not overwrite the file", async () => {
    const contents = '"just a string"';
    writeFileSync(keypairPath, contents);
    const identity = new HubIdentity(keypairPath);

    await expect(identity.getOrCreateKeypair()).rejects.toThrow(
      "Hub keypair file must contain a JSON object",
    );

    expect(readFileSync(keypairPath, "utf8")).toBe(contents);
    expect(mockedSetHubKey).not.toHaveBeenCalled();
  });
});

describe("after initialization", () => {
  it("exposes hubId / getPublicKey and a correctly derived fingerprint", async () => {
    const identity = new HubIdentity(keypairPath);
    const key = await identity.getOrCreateKeypair();

    expect(identity.hubId).toBe(key.publicKey);
    expect(identity.getPublicKey()).toBe(key.publicKey);

    const expectedFingerprint = createHash("sha256")
      .update(Buffer.from(key.publicKey, "hex"))
      .digest("hex")
      .slice(0, 32);
    expect(identity.getFingerprint()).toBe(expectedFingerprint);
    expect(identity.getFingerprint()).toHaveLength(32);
  });

  it("throws before initialization for hubId, getPublicKey, and getFingerprint", () => {
    const identity = new HubIdentity(keypairPath);

    expect(() => identity.hubId).toThrow(/Hub identity not initialized/u);
    expect(() => identity.getPublicKey()).toThrow(/Hub identity not initialized/u);
    expect(() => identity.getFingerprint()).toThrow(/Hub identity not initialized/u);
  });
});

describe("getSecretKey", () => {
  it("returns the secret key for the initialized identity", async () => {
    const identity = new HubIdentity(keypairPath);
    const key = await identity.getOrCreateKeypair();
    mockedGetHubKey.mockResolvedValue(key);

    expect(await identity.getSecretKey()).toBe(key.secretKey);
  });

  it("throws when the store no longer has the key", async () => {
    const identity = new HubIdentity(keypairPath);
    await identity.getOrCreateKeypair();
    mockedGetHubKey.mockResolvedValue(null);

    await expect(identity.getSecretKey()).rejects.toThrow(
      "Hub key is missing from credential storage",
    );
  });

  it("throws when the store returns a different key than the one initialized", async () => {
    const identity = new HubIdentity(keypairPath);
    await identity.getOrCreateKeypair();
    const otherKey = await generateHubKeypair();
    mockedGetHubKey.mockResolvedValue(otherKey);

    await expect(identity.getSecretKey()).rejects.toThrow(
      "Stored Hub key does not match the initialized Hub identity",
    );
  });
});

describe("public key file permissions", () => {
  it.skipIf(process.platform === "win32")("writes the public key file with mode 0600", async () => {
    const identity = new HubIdentity(keypairPath);
    await identity.getOrCreateKeypair();

    const mode = statSync(keypairPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
