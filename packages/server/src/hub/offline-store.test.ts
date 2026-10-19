import type { HubEnvelope } from "@chorus/shared";
import { describe, expect, it } from "vitest";
import { OfflineStore } from "./offline-store.js";

function makeEnvelope(id: string, overrides: Partial<HubEnvelope> = {}): HubEnvelope {
  return {
    id,
    from: "hub-a",
    to: "hub-b",
    type: "direct",
    timestamp: 1_000,
    nonce: "nonce",
    ciphertext: "ciphertext",
    signature: "signature",
    ...overrides,
  };
}

/** Fake clock that advances only when explicitly told to. */
function makeClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    advance: (deltaMs: number) => {
      current += deltaMs;
    },
  };
}

describe("OfflineStore.queue", () => {
  it("is idempotent for duplicate envelope IDs, returning the original message", () => {
    const store = new OfflineStore();
    const envelope = makeEnvelope("envelope-1");
    const first = store.queue(envelope, "hub-a", "hub-b");

    const duplicate = makeEnvelope("envelope-1", { from: "hub-c", to: "hub-d" });
    const second = store.queue(duplicate, "hub-c", "hub-d");

    expect(second).toBe(first);
    expect(second.fromHubId).toBe("hub-a");
    expect(second.toHubId).toBe("hub-b");
  });

  it("queues a new message with status queued and an expiry based on the TTL", () => {
    const clock = makeClock(1_000);
    const store = new OfflineStore(5_000, clock.now);
    const message = store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");

    expect(message.status).toBe("queued");
    expect(message.queuedAt).toBe(1_000);
    expect(message.expiresAt).toBe(6_000);
    expect(message.deliveredAt).toBeUndefined();
    expect(message.settledAt).toBeUndefined();
  });
});

describe("OfflineStore.markDelivered", () => {
  it("transitions queued to delivered and stamps deliveredAt", () => {
    const clock = makeClock(1_000);
    const store = new OfflineStore(5_000, clock.now);
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");

    clock.advance(500);
    store.markDelivered("envelope-1");

    const message = store.get("envelope-1");
    expect(message?.status).toBe("delivered");
    expect(message?.deliveredAt).toBe(1_500);
  });

  it("is a no-op for an unknown message ID", () => {
    const store = new OfflineStore();
    expect(() => store.markDelivered("missing")).not.toThrow();
    expect(store.has("missing")).toBe(false);
  });

  it("does not overwrite deliveredAt when called again while already delivered", () => {
    const clock = makeClock(1_000);
    const store = new OfflineStore(5_000, clock.now);
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");

    clock.advance(500);
    store.markDelivered("envelope-1");
    clock.advance(500);
    store.markDelivered("envelope-1");

    expect(store.get("envelope-1")?.deliveredAt).toBe(1_500);
  });

  it("does not transition out of a settled or terminal state", () => {
    const store = new OfflineStore();
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");
    store.markSettled("envelope-1", "accepted");

    store.markDelivered("envelope-1");

    expect(store.get("envelope-1")?.status).toBe("accepted");
  });
});

describe("OfflineStore.markSettled", () => {
  it("transitions queued to accepted and stamps settledAt", () => {
    const clock = makeClock(2_000);
    const store = new OfflineStore(5_000, clock.now);
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");

    clock.advance(100);
    store.markSettled("envelope-1", "accepted");

    const message = store.get("envelope-1");
    expect(message?.status).toBe("accepted");
    expect(message?.settledAt).toBe(2_100);
  });

  it("transitions delivered to denied", () => {
    const store = new OfflineStore();
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");
    store.markDelivered("envelope-1");

    store.markSettled("envelope-1", "denied");

    expect(store.get("envelope-1")?.status).toBe("denied");
  });

  it("never flips a denied message to accepted", () => {
    const store = new OfflineStore();
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");
    store.markSettled("envelope-1", "denied");

    store.markSettled("envelope-1", "accepted");

    expect(store.get("envelope-1")?.status).toBe("denied");
  });

  it("never flips an accepted message to denied", () => {
    const store = new OfflineStore();
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");
    store.markSettled("envelope-1", "accepted");

    store.markSettled("envelope-1", "denied");

    expect(store.get("envelope-1")?.status).toBe("accepted");
  });

  it("is a no-op for an unknown message ID", () => {
    const store = new OfflineStore();
    expect(() => store.markSettled("missing", "accepted")).not.toThrow();
  });
});

describe("OfflineStore.markComplete", () => {
  it("transitions accepted to done and stamps settledAt", () => {
    const clock = makeClock(3_000);
    const store = new OfflineStore(5_000, clock.now);
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");
    store.markSettled("envelope-1", "accepted");

    clock.advance(50);
    store.markComplete("envelope-1", "done");

    const message = store.get("envelope-1");
    expect(message?.status).toBe("done");
    expect(message?.settledAt).toBe(3_050);
  });

  it("transitions a queued message directly to error", () => {
    const store = new OfflineStore();
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");

    store.markComplete("envelope-1", "error");

    expect(store.get("envelope-1")?.status).toBe("error");
  });

  it("never overrides a denied message", () => {
    const store = new OfflineStore();
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");
    store.markSettled("envelope-1", "denied");

    store.markComplete("envelope-1", "done");

    expect(store.get("envelope-1")?.status).toBe("denied");
  });

  it("is a no-op once already done", () => {
    const clock = makeClock(1_000);
    const store = new OfflineStore(5_000, clock.now);
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");
    store.markComplete("envelope-1", "done");
    const settledAt = store.get("envelope-1")?.settledAt;

    clock.advance(1_000);
    store.markComplete("envelope-1", "error");

    const message = store.get("envelope-1");
    expect(message?.status).toBe("done");
    expect(message?.settledAt).toBe(settledAt);
  });

  it("is a no-op once already error", () => {
    const store = new OfflineStore();
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");
    store.markComplete("envelope-1", "error");

    store.markComplete("envelope-1", "done");

    expect(store.get("envelope-1")?.status).toBe("error");
  });

  it("is a no-op for an unknown message ID", () => {
    const store = new OfflineStore();
    expect(() => store.markComplete("missing", "done")).not.toThrow();
  });
});

describe("OfflineStore.markRetryable", () => {
  it("falls a delivered message back to queued and clears deliveredAt", () => {
    const store = new OfflineStore();
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");
    store.markDelivered("envelope-1");

    store.markRetryable("envelope-1");

    const message = store.get("envelope-1");
    expect(message?.status).toBe("queued");
    expect(message?.deliveredAt).toBeUndefined();
  });

  it("is a no-op for a message that is still queued", () => {
    const store = new OfflineStore();
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");

    store.markRetryable("envelope-1");

    expect(store.get("envelope-1")?.status).toBe("queued");
  });

  it("is a no-op for a settled or terminal message", () => {
    const store = new OfflineStore();
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");
    store.markSettled("envelope-1", "accepted");

    store.markRetryable("envelope-1");

    expect(store.get("envelope-1")?.status).toBe("accepted");
  });

  it("is a no-op for an unknown message ID", () => {
    const store = new OfflineStore();
    expect(() => store.markRetryable("missing")).not.toThrow();
  });
});

describe("OfflineStore.getPendingForHub", () => {
  it("returns only queued/delivered messages for the given Hub, in FIFO order", () => {
    const clock = makeClock(0);
    const store = new OfflineStore(100_000, clock.now);

    clock.advance(10);
    store.queue(makeEnvelope("envelope-2"), "hub-a", "hub-b");
    clock.advance(10);
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");
    clock.advance(10);
    store.queue(makeEnvelope("envelope-3"), "hub-a", "hub-b");
    store.markDelivered("envelope-3");

    // Different recipient, should be excluded.
    store.queue(makeEnvelope("envelope-4"), "hub-a", "hub-c");
    // Settled, should be excluded despite matching the recipient.
    store.queue(makeEnvelope("envelope-5"), "hub-a", "hub-b");
    store.markSettled("envelope-5", "accepted");

    const pending = store.getPendingForHub("hub-b");

    expect(pending.map((message) => message.id)).toEqual([
      "envelope-2",
      "envelope-1",
      "envelope-3",
    ]);
  });

  it("excludes messages whose TTL has expired", () => {
    const clock = makeClock(0);
    const store = new OfflineStore(1_000, clock.now);
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");

    clock.advance(1_001);

    expect(store.getPendingForHub("hub-b")).toEqual([]);
  });

  it("includes a message right up to its expiry boundary", () => {
    const clock = makeClock(0);
    const store = new OfflineStore(1_000, clock.now);
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");

    clock.advance(999);

    expect(store.getPendingForHub("hub-b").map((message) => message.id)).toEqual(["envelope-1"]);
  });
});

describe("OfflineStore.purgeExpired", () => {
  it("removes only expired messages and returns the purged count", () => {
    const clock = makeClock(0);
    const store = new OfflineStore(1_000, clock.now);
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");

    clock.advance(500);
    store.queue(makeEnvelope("envelope-2"), "hub-a", "hub-b");

    clock.advance(600);
    const purged = store.purgeExpired();

    expect(purged).toBe(1);
    expect(store.has("envelope-1")).toBe(false);
    expect(store.has("envelope-2")).toBe(true);
  });

  it("returns 0 when nothing is expired", () => {
    const store = new OfflineStore();
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");

    expect(store.purgeExpired()).toBe(0);
  });
});

describe("OfflineStore.has/get", () => {
  it("has() reflects presence regardless of status", () => {
    const store = new OfflineStore();
    expect(store.has("envelope-1")).toBe(false);

    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");
    expect(store.has("envelope-1")).toBe(true);
  });

  it("get() returns undefined for an unknown message", () => {
    const store = new OfflineStore();
    expect(store.get("missing")).toBeUndefined();
  });

  it("get() returns a defensive copy whose mutation does not affect the store", () => {
    const store = new OfflineStore();
    store.queue(makeEnvelope("envelope-1"), "hub-a", "hub-b");

    const snapshot = store.get("envelope-1");
    expect(snapshot).toBeDefined();
    if (!snapshot) throw new Error("expected snapshot");
    snapshot.status = "done";
    snapshot.envelope.ciphertext = "tampered";

    const fresh = store.get("envelope-1");
    expect(fresh?.status).toBe("queued");
    expect(fresh?.envelope.ciphertext).toBe("ciphertext");
  });
});
