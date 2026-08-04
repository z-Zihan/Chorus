import type { Agent, DirectoryManifest, User } from "@agentlink/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRegistry } from "../agent/registry.js";
import { createDatabase, type DatabaseContext } from "../db/index.js";
import { Repository } from "../db/repository.js";
import { generateUserKeyPair } from "../identity/user-keys.js";
import { DirectoryService } from "./directory.js";

const databases: DatabaseContext[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const database of databases.splice(0)) database.sqlite.close();
});

describe("DirectoryService", () => {
  it("builds a minimal local directory and filters agents by visibility", () => {
    const keyPair = generateUserKeyPair();
    const localUser: User = {
      id: "usr_local",
      name: "Local User",
      publicKey: keyPair.publicKey,
      kind: "local",
      createdAt: 1,
      updatedAt: 1,
    };
    const agents = [
      agentFixture("trusted-agent", "trusted"),
      agentFixture("room-agent", "room"),
      agentFixture("public-agent", "public"),
    ];
    const repository = {
      getUser: vi.fn(() => localUser),
    } as unknown as Repository;
    const registry = {
      list: vi.fn(() => agents),
    } as unknown as AgentRegistry;
    const service = new DirectoryService(repository, registry, "hub-local");

    const manifest = service.buildLocalDirectory();

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      directoryVersion: 1,
      user: {
        id: "usr_local",
        name: "Local User",
        hubId: "hub-local",
        publicKey: keyPair.publicKey,
      },
      revokedAgentIds: [],
      signature: "",
    });
    expect(manifest?.expiresAt).toBe((manifest?.issuedAt ?? 0) + 10 * 60 * 1000);
    expect(manifest?.agents.map(({ id }) => id)).toEqual(["trusted-agent", "public-agent"]);
    expect(manifest?.agents[0]).toEqual({
      id: "trusted-agent",
      name: "trusted-agent name",
      description: "trusted-agent description",
      type: "mock",
      capabilities: [],
      status: "online",
      visibility: "trusted",
    });

    const roomManifest = service.buildLocalDirectory({ trusted: false, sharedRoom: true });
    expect(roomManifest?.agents.map(({ id }) => id)).toEqual(["room-agent", "public-agent"]);
    expect(roomManifest?.directoryVersion).toBe(2);
  });

  it("signs manifests and rejects a signature after tampering", () => {
    const keyPair = generateUserKeyPair();
    const service = mockService(keyPair.publicKey);
    const unsigned = service.buildLocalDirectory();
    if (!unsigned) throw new Error("Missing local directory fixture");

    const signed = service.signManifest(unsigned, keyPair.privateKey);

    expect(signed.signature).not.toBe("");
    expect(service.verifyManifest(signed)).toBe(true);
    expect(service.verifyManifest({ ...signed, directoryVersion: 999 })).toBe(false);
  });

  it("checks expiry and monotonically increasing versions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const service = mockService(generateUserKeyPair().publicKey);
    const current = manifestFixture({ directoryVersion: 3, expiresAt: 10_001 });

    expect(service.isExpired(current)).toBe(false);
    vi.setSystemTime(10_002);
    expect(service.isExpired(current)).toBe(true);
    expect(service.isNewer(manifestFixture({ directoryVersion: 4 }), current)).toBe(true);
    expect(service.isNewer(manifestFixture({ directoryVersion: 3 }), current)).toBe(false);
    expect(service.isNewer(manifestFixture({ directoryVersion: 2 }), current)).toBe(false);
    expect(service.isNewer(current)).toBe(true);
  });

  it("registers a remote User and agents and applies revocations", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const registry = new AgentRegistry(repository);
    const service = new DirectoryService(repository, registry);
    const initial = manifestFixture({
      directoryVersion: 1,
      agents: [directoryAgent("agent-a"), directoryAgent("agent-b")],
    });

    service.applyRemoteDirectory(initial);

    expect(repository.getUser("usr_remote")).toMatchObject({
      id: "usr_remote",
      name: "Remote User",
      hubId: "hub-remote",
      kind: "remote",
    });
    expect(registry.getRemoteAgents()).toEqual([
      { id: "remote:hub-remote:agent-a", name: "agent-a name", hubId: "hub-remote" },
      { id: "remote:hub-remote:agent-b", name: "agent-b name", hubId: "hub-remote" },
    ]);

    const revoked = manifestFixture({
      directoryVersion: 2,
      agents: [],
      revokedAgentIds: ["agent-a"],
    });
    service.applyRemoteDirectory(revoked);

    expect(registry.getRemoteAgents()).toEqual([
      { id: "remote:hub-remote:agent-b", name: "agent-b name", hubId: "hub-remote" },
    ]);
    expect(service.getRemoteDirectory("hub-remote")).toBe(revoked);
  });
});

function mockService(publicKey: string): DirectoryService {
  const user: User = {
    id: "usr_local",
    name: "Local User",
    publicKey,
    kind: "local",
    createdAt: 1,
    updatedAt: 1,
  };
  return new DirectoryService(
    { getUser: vi.fn(() => user) } as unknown as Repository,
    { list: vi.fn(() => []) } as unknown as AgentRegistry,
    "hub-local",
  );
}

function agentFixture(
  id: string,
  visibility: DirectoryManifest["agents"][number]["visibility"],
): Agent & { visibility: typeof visibility } {
  return {
    id,
    name: `${id} name`,
    description: `${id} description`,
    type: "mock",
    status: "online",
    visibility,
    disabled: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function directoryAgent(id: string): DirectoryManifest["agents"][number] {
  return {
    id,
    name: `${id} name`,
    type: "mock",
    capabilities: [],
    status: "online",
    visibility: "trusted",
  };
}

function manifestFixture(overrides: Partial<DirectoryManifest> = {}): DirectoryManifest {
  return {
    schemaVersion: 1,
    directoryVersion: 1,
    issuedAt: 1_000,
    expiresAt: 20_000,
    user: {
      id: "usr_remote",
      name: "Remote User",
      hubId: "hub-remote",
      publicKey: generateUserKeyPair().publicKey,
    },
    agents: [],
    revokedAgentIds: [],
    signature: "signature",
    ...overrides,
  };
}
