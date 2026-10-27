import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { createDatabase } from "../db/index.js";
import { Repository } from "../db/repository.js";
import type { ClientToken, ClientTokenRepository } from "./token-store.js";
import { TokenStore, hashToken, tokenHasScope } from "./token-store.js";

afterEach(() => {
  vi.useRealTimers();
});

interface RepositoryStub extends ClientTokenRepository {
  createClientToken: Mock<(token: ClientToken) => void>;
  listClientTokens: Mock<() => ClientToken[]>;
  updateClientTokenLastUsed: Mock<(id: string, lastUsedAt: number) => boolean>;
  revokeClientToken: Mock<(id: string) => boolean>;
  purgeExpiredClientTokens: Mock<(now?: number) => number>;
}

function createRepositoryStub(initial: ClientToken[] = []): RepositoryStub {
  return {
    createClientToken: vi.fn(),
    listClientTokens: vi.fn(() => initial),
    updateClientTokenLastUsed: vi.fn(() => true),
    revokeClientToken: vi.fn(() => true),
    purgeExpiredClientTokens: vi.fn(() => 0),
  };
}

function firstCreatedRecord(repository: RepositoryStub): ClientToken {
  const record = repository.createClientToken.mock.calls[0]?.[0];
  if (!record) throw new Error("createClientToken was not called");
  return record;
}

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

describe("TokenStore input validation", () => {
  it("rejects an empty clientId without touching the repository", () => {
    const repository = createRepositoryStub();
    const store = new TokenStore(repository);

    expect(() => store.create("", ["agents:read"], 60_000)).toThrow(
      "clientId must be a non-empty string",
    );
    expect(repository.createClientToken).not.toHaveBeenCalled();
  });

  it.each(["   ", "\t\n"])("rejects a whitespace-only clientId %p", (clientId) => {
    const repository = createRepositoryStub();
    const store = new TokenStore(repository);

    expect(() => store.create(clientId, ["agents:read"], 60_000)).toThrow(
      "clientId must be a non-empty string",
    );
    expect(repository.createClientToken).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects an invalid ttlMs %p without touching the repository",
    (ttlMs) => {
      const repository = createRepositoryStub();
      const store = new TokenStore(repository);

      expect(() => store.create("openclaw", ["agents:read"], ttlMs)).toThrow(
        "ttlMs must be greater than zero",
      );
      expect(repository.createClientToken).not.toHaveBeenCalled();
    },
  );
});

describe("TokenStore scopes and userId normalization", () => {
  it("deduplicates scopes when creating a token", () => {
    const store = new TokenStore();
    const created = store.create("openclaw", ["agents:read", "agents:read", "ws:connect"], 60_000);

    expect(store.list().find((token) => token.id === created.id)?.scopes).toEqual([
      "agents:read",
      "ws:connect",
    ]);
  });

  it("copies the scopes array so external mutation does not leak either way", () => {
    const store = new TokenStore();
    const scopes = ["agents:read"];
    const created = store.create("openclaw", scopes, 60_000);

    scopes.push("ws:connect");
    const stored = store.list().find((token) => token.id === created.id);
    expect(stored?.scopes).toEqual(["agents:read"]);

    stored?.scopes.push("mutated");
    expect(store.list().find((token) => token.id === created.id)?.scopes).toEqual(["agents:read"]);
  });

  it("treats a missing userId as undefined", () => {
    const store = new TokenStore();
    const created = store.create("openclaw", [], 60_000);
    expect(store.list().find((token) => token.id === created.id)?.userId).toBeUndefined();
  });

  it.each(["", "   "])("treats a blank userId %p as undefined", (userId) => {
    const store = new TokenStore();
    const created = store.create("openclaw", [], 60_000, userId);
    expect(store.list().find((token) => token.id === created.id)?.userId).toBeUndefined();
  });

  it("trims a userId with surrounding whitespace", () => {
    const store = new TokenStore();
    const created = store.create("openclaw", [], 60_000, "  usr_42  ");
    expect(store.list().find((token) => token.id === created.id)?.userId).toBe("usr_42");
  });
});

describe("tokenHasScope", () => {
  const baseToken: ClientToken = {
    id: "tok_1",
    hash: "hash",
    clientId: "openclaw",
    scopes: ["agents:read"],
    expiresAt: Date.now() + 60_000,
    createdAt: Date.now(),
    revoked: false,
  };

  it("matches an exact scope", () => {
    expect(tokenHasScope(baseToken, "agents:read")).toBe(true);
  });

  it("does not match on prefix", () => {
    expect(tokenHasScope({ ...baseToken, scopes: ["agents:read"] }, "agents:rea")).toBe(false);
  });

  it("matches any scope via the wildcard", () => {
    expect(tokenHasScope({ ...baseToken, scopes: ["*"] }, "agents:read")).toBe(true);
    expect(tokenHasScope({ ...baseToken, scopes: ["*"] }, "anything:else")).toBe(true);
  });

  it("matches nothing when scopes are empty, including the wildcard", () => {
    const empty = { ...baseToken, scopes: [] };
    expect(tokenHasScope(empty, "agents:read")).toBe(false);
    expect(tokenHasScope(empty, "*")).toBe(false);
  });
});

describe("TokenStore repository delegation", () => {
  it("loads existing tokens from the repository on construction", () => {
    const plaintext = "tok_existing.secret";
    const existing: ClientToken = {
      id: "tok_existing",
      hash: hashToken(plaintext),
      clientId: "openclaw",
      scopes: ["agents:read"],
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now(),
      revoked: false,
    };
    const repository = createRepositoryStub([existing]);
    const store = new TokenStore(repository);

    expect(store.list()).toEqual([existing]);
    expect(store.verify(plaintext)?.id).toBe("tok_existing");
  });

  it("passes a fully formed record to createClientToken", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const repository = createRepositoryStub();
    const store = new TokenStore(repository);

    const created = store.create("  openclaw  ", ["agents:read"], 60_000, "usr_1");
    const record = firstCreatedRecord(repository);

    expect(repository.createClientToken).toHaveBeenCalledTimes(1);
    expect(record.hash).toBe(hashToken(created.token));
    expect(JSON.stringify(record)).not.toContain(created.token);
    expect(record.clientId).toBe("openclaw");
    expect(record.expiresAt - record.createdAt).toBe(60_000);
    expect(record.revoked).toBe(false);
  });

  it("delegates verify's lastUsedAt update to the repository exactly once", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const repository = createRepositoryStub();
    const store = new TokenStore(repository);
    const { token, id } = store.create("openclaw", ["agents:read"], 60_000);

    vi.setSystemTime(new Date("2026-01-01T00:00:05Z"));
    store.verify(token);

    expect(repository.updateClientTokenLastUsed).toHaveBeenCalledTimes(1);
    expect(repository.updateClientTokenLastUsed).toHaveBeenCalledWith(
      id,
      new Date("2026-01-01T00:00:05Z").getTime(),
    );
  });

  it("does not call updateClientTokenLastUsed when verify misses or is expired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const repository = createRepositoryStub();
    const store = new TokenStore(repository);
    const { token } = store.create("openclaw", ["agents:read"], 1_000);

    store.verify("not-a-real-token");
    expect(repository.updateClientTokenLastUsed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    store.verify(token);
    expect(repository.updateClientTokenLastUsed).not.toHaveBeenCalled();
  });

  it("delegates revoke to the repository and rejects duplicate or unknown ids", () => {
    const repository = createRepositoryStub();
    const store = new TokenStore(repository);
    const { id } = store.create("openclaw", ["agents:read"], 60_000);

    expect(store.revoke(id)).toBe(true);
    expect(repository.revokeClientToken).toHaveBeenCalledTimes(1);
    expect(repository.revokeClientToken).toHaveBeenCalledWith(id);

    expect(store.revoke(id)).toBe(false);
    expect(store.revoke("tok_unknown")).toBe(false);
    expect(repository.revokeClientToken).toHaveBeenCalledTimes(1);
  });

  it("purges expired tokens from memory and delegates with a now+1 offset", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const repository = createRepositoryStub();
    const store = new TokenStore(repository);
    store.create("short-lived", [], 1_000);
    store.create("long-lived", [], 60_000);

    vi.advanceTimersByTime(1_000);
    const now = Date.now();
    expect(store.purgeExpired()).toBe(1);
    expect(store.list()).toHaveLength(1);
    expect(repository.purgeExpiredClientTokens).toHaveBeenCalledTimes(1);
    expect(repository.purgeExpiredClientTokens).toHaveBeenCalledWith(now + 1);
  });

  it("is safe to use without a repository", () => {
    const store = new TokenStore();
    const created = store.create("openclaw", ["agents:read"], 60_000);

    expect(store.verify(created.token)?.id).toBe(created.id);
    expect(store.revoke(created.id)).toBe(true);
    expect(store.purgeExpired()).toBe(0);
    expect(store.list()).toEqual([]);
  });
});

describe("TokenStore.list", () => {
  it("excludes revoked and expired tokens but includes active ones", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const store = new TokenStore();
    const active = store.create("active", [], 60_000);
    const revoked = store.create("revoked", [], 60_000);
    store.create("short-lived", [], 1_000);

    store.revoke(revoked.id);
    vi.advanceTimersByTime(1_000);

    expect(store.list().map((token) => token.id)).toEqual([active.id]);
  });

  it("returns a deep copy that cannot mutate internal state", () => {
    const store = new TokenStore();
    const created = store.create("openclaw", ["agents:read"], 60_000);

    const first = store.list()[0];
    if (!first) throw new Error("expected a listed token");
    first.clientId = "mutated";
    first.scopes.push("mutated-scope");

    const second = store.list()[0];
    expect(second?.clientId).toBe("openclaw");
    expect(second?.scopes).toEqual(["agents:read"]);
    expect(second?.scopes).not.toBe(first.scopes);
    void created;
  });
});

describe("TokenStore reload persistence", () => {
  it("persists a revocation so a reloaded store can no longer verify or list it", () => {
    const database = createDatabase(":memory:");
    try {
      const repository = new Repository(database);
      const store = new TokenStore(repository);
      const created = store.create("persistent", ["ws:connect"], 60_000);

      expect(store.revoke(created.id)).toBe(true);

      const reloaded = new TokenStore(repository);
      expect(reloaded.verify(created.token)).toBeNull();
      expect(reloaded.list()).toEqual([]);
      expect(reloaded.revoke(created.id)).toBe(false);
    } finally {
      database.sqlite.close();
    }
  });
});
