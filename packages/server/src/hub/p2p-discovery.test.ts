import { describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => void;

interface FakeServiceOptions {
  txt?: Record<string, unknown>;
  port?: number;
  addresses?: string[];
  host?: string;
}

function fakeService(overrides: FakeServiceOptions = {}) {
  return {
    txt: {
      hubId: "hub-remote",
      publicKey: "pub-remote",
      displayName: "Remote Hub",
      version: "1.0",
    },
    port: 9000,
    addresses: ["192.168.1.10"],
    host: "remote.local",
    ...overrides,
  };
}

const hoisted = vi.hoisted(() => {
  class FakeBrowser {
    private readonly handlers = new Map<string, Handler[]>();
    readonly stop = vi.fn();
    on(event: string, handler: Handler): this {
      const list = this.handlers.get(event) ?? [];
      list.push(handler);
      this.handlers.set(event, list);
      return this;
    }
    trigger(event: string, ...args: unknown[]): void {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }
  }

  class FakeServiceHandle {
    readonly stop = vi.fn();
  }

  class FakeBonjour {
    static instances: FakeBonjour[] = [];
    readonly browser = new FakeBrowser();
    readonly serviceHandle = new FakeServiceHandle();
    readonly destroy = vi.fn();
    readonly publish = vi.fn((opts: unknown) => {
      this.lastPublishOpts = opts;
      return this.serviceHandle;
    });
    readonly find = vi.fn(() => this.browser);
    lastPublishOpts?: unknown;
    constructor() {
      FakeBonjour.instances.push(this);
    }
  }

  return { FakeBonjour };
});

vi.mock("bonjour-service", () => ({ default: hoisted.FakeBonjour }));

import { P2PDiscovery } from "./p2p-discovery.js";

const { FakeBonjour } = hoisted;

function latestBonjour() {
  const instance = FakeBonjour.instances.at(-1);
  if (!instance) throw new Error("expected a FakeBonjour instance");
  return instance;
}

function startDiscovery(hubId = "local-hub") {
  const discovery = new P2PDiscovery();
  discovery.start(hubId, "local-pub-key", "Local Hub", 7000);
  const bonjour = latestBonjour();
  return { discovery, bonjour, browser: bonjour.browser };
}

describe("P2PDiscovery.start / discover", () => {
  it("starts with an empty discover() list", () => {
    const { discovery } = startDiscovery();
    expect(discovery.discover()).toEqual([]);
  });

  it("adds a hub reported via a valid 'up' service event", () => {
    const { discovery, browser } = startDiscovery();

    browser.trigger("up", fakeService());

    expect(discovery.discover()).toEqual([
      {
        hubId: "hub-remote",
        publicKey: "pub-remote",
        displayName: "Remote Hub",
        host: "192.168.1.10",
        port: 9000,
        txt: {
          hubId: "hub-remote",
          publicKey: "pub-remote",
          displayName: "Remote Hub",
          version: "1.0",
        },
      },
    ]);
  });

  it("falls back displayName to the first 8 characters of hubId when txt.displayName is missing", () => {
    const { discovery, browser } = startDiscovery();

    browser.trigger(
      "up",
      fakeService({
        txt: { hubId: "hub-remote-long-id", publicKey: "pub-remote" },
      }),
    );

    const [discovered] = discovery.discover();
    expect(discovered?.displayName).toBe("hub-remo");
  });

  it("prefers an IPv4-looking address (one containing '.') among multiple addresses", () => {
    const { discovery, browser } = startDiscovery();

    browser.trigger("up", fakeService({ addresses: ["fe80::1", "10.0.0.5", "fe80::2"] }));

    const [discovered] = discovery.discover();
    expect(discovered?.host).toBe("10.0.0.5");
  });

  it("falls back to the first address when none contain a '.'", () => {
    const { discovery, browser } = startDiscovery();

    browser.trigger("up", fakeService({ addresses: ["fe80::1", "fe80::2"] }));

    const [discovered] = discovery.discover();
    expect(discovered?.host).toBe("fe80::1");
  });

  it("falls back to service.host when addresses is empty", () => {
    const { discovery, browser } = startDiscovery();

    browser.trigger("up", fakeService({ addresses: [], host: "fallback.local" }));

    const [discovered] = discovery.discover();
    expect(discovered?.host).toBe("fallback.local");
  });

  it("falls back to service.host when addresses is undefined", () => {
    const { discovery, browser } = startDiscovery();
    const service = fakeService({ host: "fallback.local" });
    delete (service as { addresses?: string[] }).addresses;

    browser.trigger("up", service);

    const [discovered] = discovery.discover();
    expect(discovered?.host).toBe("fallback.local");
  });

  it("ignores a service reporting the local hubId", () => {
    const { discovery, browser } = startDiscovery("hub-remote");

    browser.trigger("up", fakeService({ txt: { hubId: "hub-remote", publicKey: "pub-remote" } }));

    expect(discovery.discover()).toEqual([]);
  });

  it("ignores a service with no publicKey in its txt record", () => {
    const { discovery, browser } = startDiscovery();

    browser.trigger("up", fakeService({ txt: { hubId: "hub-remote" } }));

    expect(discovery.discover()).toEqual([]);
  });

  it("ignores a service whose port is not an integer", () => {
    const { discovery, browser } = startDiscovery();

    browser.trigger("up", fakeService({ port: 9000.5 }));

    expect(discovery.discover()).toEqual([]);
  });

  it("ignores a service with no usable host (no addresses and no service.host)", () => {
    const { discovery, browser } = startDiscovery();

    browser.trigger("up", fakeService({ addresses: [], host: "" }));

    expect(discovery.discover()).toEqual([]);
  });

  it("decodes a Buffer txt value (utf8) and a number txt value into strings", () => {
    const { discovery, browser } = startDiscovery();

    browser.trigger(
      "up",
      fakeService({
        txt: {
          hubId: Buffer.from("hub-remote", "utf8"),
          publicKey: "pub-remote",
          customFlag: 42,
        },
      }),
    );

    const [discovered] = discovery.discover();
    expect(discovered?.hubId).toBe("hub-remote");
    expect(discovered?.txt.customFlag).toBe("42");
  });
});

describe("P2PDiscovery.onDiscovered", () => {
  it("notifies listeners exactly once for a newly discovered hub", () => {
    const { discovery, browser } = startDiscovery();
    const listener = vi.fn();
    discovery.onDiscovered(listener);

    browser.trigger("up", fakeService());

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(discovery.discover()[0]);
  });

  it("updates discover() content on a repeat 'up' for the same hubId without re-notifying", () => {
    const { discovery, browser } = startDiscovery();
    const listener = vi.fn();
    discovery.onDiscovered(listener);

    browser.trigger(
      "up",
      fakeService({ txt: { hubId: "hub-remote", publicKey: "pub-remote", displayName: "First" } }),
    );
    browser.trigger(
      "up",
      fakeService({ txt: { hubId: "hub-remote", publicKey: "pub-remote", displayName: "Second" } }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(discovery.discover()).toHaveLength(1);
    expect(discovery.discover()[0]?.displayName).toBe("Second");
  });

  it("stops notifying after the returned unsubscribe function is called", () => {
    const { discovery, browser } = startDiscovery();
    const listener = vi.fn();
    const unsubscribe = discovery.onDiscovered(listener);

    unsubscribe();
    browser.trigger("up", fakeService());

    expect(listener).not.toHaveBeenCalled();
    expect(discovery.discover()).toHaveLength(1);
  });
});

describe("P2PDiscovery 'down' events", () => {
  it("removes a hub by txt.hubId", () => {
    const { discovery, browser } = startDiscovery();
    browser.trigger("up", fakeService());
    expect(discovery.discover()).toHaveLength(1);

    browser.trigger("down", fakeService());

    expect(discovery.discover()).toEqual([]);
  });

  it("does not throw when the 'down' service has no txt.hubId", () => {
    const { browser } = startDiscovery();

    expect(() => browser.trigger("down", fakeService({ txt: {} }))).not.toThrow();
  });

  it("does not throw when the 'down' service has no txt at all", () => {
    const { browser } = startDiscovery();
    const service = fakeService();
    delete (service as { txt?: unknown }).txt;

    expect(() => browser.trigger("down", service)).not.toThrow();
  });
});

describe("P2PDiscovery.stop", () => {
  it("clears discover() and allows a subsequent start()", () => {
    const { discovery, browser, bonjour } = startDiscovery();
    browser.trigger("up", fakeService());
    expect(discovery.discover()).toHaveLength(1);

    discovery.stop();

    expect(discovery.discover()).toEqual([]);
    expect(bonjour.browser.stop).toHaveBeenCalled();
    expect(bonjour.serviceHandle.stop).toHaveBeenCalled();
    expect(bonjour.destroy).toHaveBeenCalled();

    discovery.start("local-hub", "local-pub-key", "Local Hub", 7001);
    const nextBonjour = latestBonjour();
    expect(nextBonjour).not.toBe(bonjour);
    expect(discovery.discover()).toEqual([]);
  });
});
