import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../db/index.js";
import { Repository } from "../db/repository.js";
import { TokenStore, hashToken } from "./token-store.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("TokenStore", () => {
  it("creates a token and only stores its SHA-256 hash", () => {
    const store = new TokenStore();
    const created = store.create("openclaw", ["agents:read"], 60_000, "usr_1");
    const listed = store.list()[0];

    expect(created.id).toMatch(/^tok_/u);
    expect(created.token).not.toBe(listed?.hash);
    expect(listed).toMatchObject({
      id: created.id,
      hash: hashToken(created.token),
      clientId: "openclaw",
      userId: "usr_1",
      scopes: ["agents:read"],
      revoked: false,
    });
    expect(store.verify(created.token)?.id).toBe(created.id);
    expect(store.verify("not-the-token")).toBeNull();
  });

  it("rejects and purges expired tokens", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const store = new TokenStore();
    const { token } = store.create("short-lived", [], 1_000);

    vi.advanceTimersByTime(1_000);
    expect(store.verify(token)).toBeNull();
    expect(store.purgeExpired()).toBe(1);
    expect(store.list()).toEqual([]);
  });

  it("rejects a revoked token", () => {
    const store = new TokenStore();
    const created = store.create("external-agent", ["messages:write"], 60_000);

    expect(store.revoke(created.id)).toBe(true);
    expect(store.verify(created.token)).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it("persists only the hash and can verify after reload", () => {
    const database = createDatabase(":memory:");
    try {
      const repository = new Repository(database);
      const created = new TokenStore(repository).create("persistent", ["ws:connect"], 60_000);
      const row = database.sqlite
        .prepare("SELECT hash, scopes FROM client_tokens WHERE id = ?")
        .get(created.id) as { hash: string; scopes: string };

      expect(row.hash).toBe(hashToken(created.token));
      expect(JSON.stringify(row)).not.toContain(created.token);
      expect(new TokenStore(repository).verify(created.token)?.scopes).toEqual(["ws:connect"]);
    } finally {
      database.sqlite.close();
    }
  });
});
