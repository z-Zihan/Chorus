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

  it("generates the same deterministic ID for the same Hub and source Agent", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    const registry = new AgentRegistry(new Repository(database));

    const firstId = registry.registerRemoteAgent("agent-a", "hub-remote", "Agent A");
    const secondId = registry.registerRemoteAgent("agent-a", "hub-remote", "Renamed Agent A");

    expect(firstId).toBe("remote_T0AxriorP1mjb3yB");
    expect(secondId).toBe(firstId);
    expect(registry.getRemoteAgents()).toHaveLength(1);
    expect(registry.getRemoteAgents()[0]).toMatchObject({
      id: firstId,
      sourceAgentId: "agent-a",
      name: "Renamed Agent A",
      hubId: "hub-remote",
      status: "online",
      stale: false,
    });
  });

  it("persists same-name Agents from different Hubs without collisions", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const registry = new AgentRegistry(repository);
    const service = new DirectoryService(repository, registry);
    const hubA = manifestFixture({
      user: remoteUser("usr-a", "hub-a", "Alice"),
      agents: [{ ...directoryAgent("claude"), name: "Claude Code" }],
    });
    const hubB = manifestFixture({
      user: remoteUser("usr-b", "hub-b", "Bob"),
      agents: [{ ...directoryAgent("claude"), name: "Claude Code" }],
    });

    service.applyRemoteDirectory(hubA);
    service.applyRemoteDirectory(hubB);

    const remoteAgents = registry.getRemoteAgents();
    expect(remoteAgents).toHaveLength(2);
    expect(remoteAgents.map(({ id }) => id)).toEqual([
      "remote_jGFVUm-C9CYXI8Xz",
      "remote_aYlIHhveZ5ehezzL",
    ]);
    expect(remoteAgents.map(({ name }) => name)).toEqual(["Claude Code", "Claude Code"]);

    const rows = repository.listAgentRows();
    expect(rows).toHaveLength(2);
    expect(rows.map(({ id }) => id)).toEqual(remoteAgents.map(({ id }) => id));
    for (const row of rows) {
      expect(row).toMatchObject({
        name: "Claude Code",
        config: "{}",
        credentialRef: null,
        ownerType: "remote",
        disabled: false,
      });
    }
  });

  it("marks old remote Agents stale before refreshing the current directory", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const registry = new AgentRegistry(repository);
    const service = new DirectoryService(repository, registry);
    service.applyRemoteDirectory(
      manifestFixture({
        directoryVersion: 1,
        agents: [directoryAgent("agent-a"), directoryAgent("agent-b")],
      }),
    );

    service.markStaleAgents("hub-remote");

    expect(registry.getRemoteAgents()).toEqual([
      expect.objectContaining({ sourceAgentId: "agent-a", status: "offline", stale: true }),
      expect.objectContaining({ sourceAgentId: "agent-b", status: "offline", stale: true }),
    ]);
    expect(repository.listAgentRows().every(({ disabled }) => disabled)).toBe(true);

    service.applyRemoteDirectory(
      manifestFixture({
        directoryVersion: 2,
        agents: [directoryAgent("agent-a")],
      }),
    );

    expect(registry.getRemoteAgents()).toEqual([
      expect.objectContaining({ sourceAgentId: "agent-a", status: "online", stale: false }),
      expect.objectContaining({ sourceAgentId: "agent-b", status: "offline", stale: true }),
    ]);
    expect(repository.getAgentRow("remote_T0AxriorP1mjb3yB")?.disabled).toBe(false);
    expect(repository.getAgentRow("remote_pbICehaU4Xkd8Fp8")?.disabled).toBe(true);
  });

  it("registers a remote User and removes revoked Agents from memory and DB", () => {
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
    expect(repository.getAgentRow("remote_T0AxriorP1mjb3yB")).toMatchObject({
      config: "{}",
      credentialRef: null,
      ownerId: "usr_remote",
      ownerType: "remote",
    });

    const revoked = manifestFixture({
      directoryVersion: 2,
      agents: [directoryAgent("agent-b")],
      revokedAgentIds: ["agent-a"],
    });
    service.applyRemoteDirectory(revoked);

    expect(registry.getRemoteAgents()).toEqual([
      expect.objectContaining({
        id: "remote_pbICehaU4Xkd8Fp8",
        sourceAgentId: "agent-b",
        name: "agent-b name",
        hubId: "hub-remote",
        stale: false,
      }),
    ]);
    expect(repository.getAgentRow("remote_T0AxriorP1mjb3yB")).toBeUndefined();
    expect(repository.getAgentRow("remote_pbICehaU4Xkd8Fp8")?.disabled).toBe(false);
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

function remoteUser(id: string, hubId: string, name: string): DirectoryManifest["user"] {
  return {
    id,
    name,
    hubId,
    publicKey: generateUserKeyPair().publicKey,
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
