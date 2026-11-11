// Rooms route family (hub.ts POST/GET /api/hub/rooms, GET /api/hub/rooms/:id,
// POST/DELETE /api/hub/rooms/:id/agents[/:agentId]) — invitation routes are
// covered separately in hub-invitations.test.ts.
//
// The credential backend is pinned to the encrypted-file store globally by
// vitest.setup.ts (CHORUS_CREDENTIAL_BACKEND=file), so the "user key
// unavailable" (503) branch and the key deletion below run against the
// per-worker temp credential file instead of the developer's keychain.

import type { HubConfig, HubConnectionState, RoomInfo, RoomMember } from "@chorus/shared";
import Fastify from "fastify";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AgentRegistry } from "../../agent/registry.js";
import { deleteCredential, setUserKey } from "../../credential-store.js";
import { createDatabase, type DatabaseContext } from "../../db/index.js";
import { Repository } from "../../db/repository.js";
import { ConnectionManager } from "../../hub/connection-manager.js";
import type { HubIdentity } from "../../hub/identity.js";
import { isOwnerProof, verifyOwnerProof } from "../../hub/owner-proof.js";
import { P2PListener } from "../../hub/p2p-listener.js";
import type { RelayClient } from "../../hub/relay-client.js";
import { generateUserKeyPair, type UserKeyPair } from "../../identity/user-keys.js";
import { registerHubRoutes } from "../hub.js";

const RELAY_URL = "ws://relay.invalid";
// Mirrors the module-private USER_KEY_IDENTIFIER in credential-store.ts (not exported).
const USER_KEY_IDENTIFIER = "chorus:user-key";

interface RelayClientMock {
  state: HubConnectionState;
  createRoomRequest: Mock;
  joinRoom: Mock;
  getRoomMembersRequest: Mock;
  getRoomRequest: Mock;
  roomCas: Mock;
}

function createRelayClientMock(): RelayClientMock {
  return {
    state: "disconnected",
    createRoomRequest: vi.fn(),
    joinRoom: vi.fn(),
    getRoomMembersRequest: vi.fn().mockResolvedValue([]),
    getRoomRequest: vi.fn(),
    roomCas: vi.fn(),
  };
}

function roomInfo(overrides: Partial<RoomInfo> = {}): RoomInfo {
  return {
    id: "room-x",
    name: "Room X",
    createdBy: "hub-local",
    createdAt: 1_000,
    members: [],
    ...overrides,
  };
}

function roomMember(overrides: Partial<RoomMember> = {}): RoomMember {
  return {
    hubId: "hub-peer",
    publicKey: "peer-public-key",
    displayName: "Peer Hub",
    online: true,
    ...overrides,
  };
}

interface RoomsHarness {
  app: ReturnType<typeof Fastify>;
  repository: Repository;
  relayClient: RelayClientMock;
}

async function startRoomsHub(
  database: DatabaseContext,
  apps: Array<ReturnType<typeof Fastify>>,
  relayOverrides: Partial<RelayClientMock> = {},
): Promise<RoomsHarness> {
  const repository = new Repository(database);
  await repository.getOrCreateLocalUser("Test User");
  seedAgents(repository);
  const registry = new AgentRegistry(repository);
  await registry.initialize([]);
  const relayClient = { ...createRelayClientMock(), ...relayOverrides };
  const listener = new P2PListener();
  const connectionManager = new ConnectionManager(listener, relayClient as unknown as RelayClient);
  const hubConfig: HubConfig = {
    enabled: true,
    displayName: "Local Hub",
    relay: { url: RELAY_URL },
    p2p: { enabled: false, port: 3212, discovery: "none" },
  };
  const app = Fastify({ logger: false });
  apps.push(app);
  registerHubRoutes(app, {
    identity: { hubId: "hub-local" } as HubIdentity,
    repository,
    relayClient: relayClient as unknown as RelayClient,
    registry,
    connectionManager,
    hubConfig,
    connect: vi.fn(),
  });
  await app.ready();
  return { app, repository, relayClient };
}

function seedAgents(repository: Repository): void {
  const base = {
    description: "",
    type: "mock" as const,
    config: {},
    source: "user" as const,
    managed: false,
    customizedFields: [],
    disabled: false,
    capabilities: [],
  };
  repository.upsertAgent(
    {
      ...base,
      id: "room-agent",
      name: "Room Agent",
      ownerId: "usr_local",
      ownerType: "system",
      visibility: "room",
    },
    null,
  );
  repository.upsertAgent(
    {
      ...base,
      id: "public-agent",
      name: "Public Agent",
      ownerId: "usr_local",
      ownerType: "system",
      visibility: "public",
    },
    null,
  );
  repository.upsertAgent(
    {
      ...base,
      id: "private-agent",
      name: "Private Agent",
      ownerId: "usr_local",
      ownerType: "system",
      visibility: "private",
    },
    null,
  );
  repository.upsertRemoteUser({
    id: "usr_other",
    name: "Other User",
    hubId: "hub-other",
    publicKey: "other-public-key",
    kind: "remote",
    createdAt: 1_000,
    updatedAt: 1_000,
    lastSeenAt: 1_000,
  });
  repository.upsertAgent(
    {
      ...base,
      id: "remote-agent",
      name: "Remote Agent",
      ownerId: "usr_other",
      ownerType: "remote",
      homeHubId: "hub-other",
    },
    null,
  );
}

function createRoomConversation(
  repository: Repository,
  options: { relayRoomId?: string; createdByHubId?: string } = {},
) {
  const createdByHubId = options.createdByHubId ?? "hub-local";
  return repository.createConversation("Room X", "cross_hub", [], options.relayRoomId ?? "room-x", {
    createdByHubId,
    adminHubIds: [createdByHubId],
  });
}

const apps: Array<ReturnType<typeof Fastify>> = [];
let database: DatabaseContext;
let userKeyPair: UserKeyPair;

beforeEach(async () => {
  database = createDatabase(":memory:");
  userKeyPair = generateUserKeyPair();
  await setUserKey(userKeyPair);
});

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  database.sqlite.close();
});

describe("POST /api/hub/rooms", () => {
  it("rejects a missing, blank, non-string name or non-object body without calling the relay", async () => {
    const hub = await startRoomsHub(database, apps);

    for (const body of [{}, { name: "" }, { name: "   " }, { name: 42 }]) {
      const response = await request(hub.app.server).post("/api/hub/rooms").send(body);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "name must be a non-empty string" });
    }
    for (const raw of ['"a string"', "null"]) {
      const response = await request(hub.app.server)
        .post("/api/hub/rooms")
        .set("Content-Type", "application/json")
        .send(raw);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "name must be a non-empty string" });
    }

    expect(hub.relayClient.createRoomRequest).not.toHaveBeenCalled();
    expect(hub.repository.listConversations({ type: "cross_hub" })).toEqual([]);
  });

  it("creates the relay room, joins it and persists a cross_hub conversation", async () => {
    const hub = await startRoomsHub(database, apps, {
      createRoomRequest: vi
        .fn()
        .mockResolvedValue(roomInfo({ id: "room-created", name: "Created Room" })),
    });

    const response = await request(hub.app.server)
      .post("/api/hub/rooms")
      .send({ name: "  Created Room  " });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ roomId: "room-created", name: "Created Room" });
    expect(hub.relayClient.createRoomRequest).toHaveBeenCalledTimes(1);
    expect(hub.relayClient.createRoomRequest).toHaveBeenCalledWith(RELAY_URL, "Created Room");
    expect(hub.relayClient.joinRoom).toHaveBeenCalledWith("room-created");
    const conversations = hub.repository.listConversations({ type: "cross_hub" });
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      title: "Created Room",
      relayRoomId: "room-created",
      metadata: { createdByHubId: "hub-local", adminHubIds: ["hub-local"] },
    });
  });
});

describe("GET /api/hub/rooms", () => {
  it("lists only cross_hub conversations that have a relay room id", async () => {
    const hub = await startRoomsHub(database, apps);
    const room = createRoomConversation(hub.repository, { relayRoomId: "room-listed" });
    hub.repository.createConversation("No Relay", "cross_hub", []);
    hub.repository.createConversation("Local Chat", "dm", []);

    const response = await request(hub.app.server).get("/api/hub/rooms");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      id: room.id,
      title: "Room X",
      type: "cross_hub",
      relayRoomId: "room-listed",
    });
  });
});

describe("GET /api/hub/rooms/:id", () => {
  it("returns 404 for unknown ids, non-cross_hub conversations and rooms without a relay id", async () => {
    const hub = await startRoomsHub(database, apps);
    const dm = hub.repository.createConversation("Local Chat", "dm", []);
    const noRelay = hub.repository.createConversation("No Relay", "cross_hub", []);

    for (const id of ["room-missing", dm.id, noRelay.id]) {
      const response = await request(hub.app.server).get(`/api/hub/rooms/${id}`);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "Room not found" });
    }
    expect(hub.relayClient.getRoomMembersRequest).not.toHaveBeenCalled();
  });

  it("resolves by relay room id and merges relay members, local agents and room state", async () => {
    const hub = await startRoomsHub(database, apps, {
      getRoomMembersRequest: vi.fn().mockResolvedValue([roomMember()]),
    });
    const conversation = createRoomConversation(hub.repository, { relayRoomId: "room-x" });
    hub.repository.addAgentToConversation(conversation.id, ["room-agent"]);

    const response = await request(hub.app.server).get("/api/hub/rooms/room-x");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: conversation.id,
      title: "Room X",
      type: "cross_hub",
      roomId: "room-x",
      revision: 1,
      keyEpoch: 1,
      managementState: "managed",
    });
    expect(hub.relayClient.getRoomMembersRequest).toHaveBeenCalledWith(RELAY_URL, "room-x");
    // members come from the relay, agents from the local membership table.
    expect(response.body.members).toEqual([roomMember()]);
    expect(response.body.agents).toHaveLength(1);
    expect(response.body.agents[0]).toMatchObject({ id: "room-agent", name: "Room Agent" });
    expect(response.body.members[0].hubId).toBe("hub-peer");
  });
});

describe("POST /api/hub/rooms/:id/agents", () => {
  it("rejects a missing, blank or non-string agentId and non-object bodies", async () => {
    const hub = await startRoomsHub(database, apps);
    createRoomConversation(hub.repository, { relayRoomId: "room-x" });

    for (const body of [{}, { agentId: "" }, { agentId: "   " }, { agentId: 42 }]) {
      const response = await request(hub.app.server)
        .post("/api/hub/rooms/room-x/agents")
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "agentId must be a non-empty string" });
    }
    const raw = await request(hub.app.server)
      .post("/api/hub/rooms/room-x/agents")
      .set("Content-Type", "application/json")
      .send('"a string"');
    expect(raw.status).toBe(400);
    expect(raw.body).toEqual({ error: "agentId must be a non-empty string" });
  });

  it("returns 404 for an unknown room, a room without a relay id, or an unknown agent", async () => {
    const hub = await startRoomsHub(database, apps);
    createRoomConversation(hub.repository, { relayRoomId: "room-x" });
    const noRelay = hub.repository.createConversation("No Relay", "cross_hub", []);

    const missingRoom = await request(hub.app.server)
      .post("/api/hub/rooms/room-missing/agents")
      .send({ agentId: "room-agent" });
    expect(missingRoom.status).toBe(404);
    expect(missingRoom.body).toEqual({ error: "Room not found" });

    const noRelayRoom = await request(hub.app.server)
      .post(`/api/hub/rooms/${noRelay.id}/agents`)
      .send({ agentId: "room-agent" });
    expect(noRelayRoom.status).toBe(404);
    expect(noRelayRoom.body).toEqual({ error: "Room not found" });

    const missingAgent = await request(hub.app.server)
      .post("/api/hub/rooms/room-x/agents")
      .send({ agentId: "ghost-agent" });
    expect(missingAgent.status).toBe(404);
    expect(missingAgent.body).toEqual({ error: "Agent not found" });
  });

  it("rejects an Agent owned by another user with AGENT_OWNER_REQUIRED", async () => {
    const hub = await startRoomsHub(database, apps);
    const conversation = createRoomConversation(hub.repository, { relayRoomId: "room-x" });

    const response = await request(hub.app.server)
      .post("/api/hub/rooms/room-x/agents")
      .send({ agentId: "remote-agent" });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "AGENT_OWNER_REQUIRED" });
    expect(hub.repository.getConversationMembers(conversation.id)).toEqual([]);
  });

  it("rejects a private Agent with AGENT_VISIBILITY_REQUIRED", async () => {
    const hub = await startRoomsHub(database, apps);
    const conversation = createRoomConversation(hub.repository, { relayRoomId: "room-x" });

    const response = await request(hub.app.server)
      .post("/api/hub/rooms/room-x/agents")
      .send({ agentId: "private-agent" });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "AGENT_VISIBILITY_REQUIRED" });
    expect(hub.repository.getConversationMembers(conversation.id)).toEqual([]);
  });

  it("returns 404 when the room state lookup misses (defensive branch)", async () => {
    const hub = await startRoomsHub(database, apps);
    createRoomConversation(hub.repository, { relayRoomId: "room-x" });
    // createConversation already seeds revision/keyEpoch on the conversation row,
    // so getRoomState cannot miss after findRoomConversation matched — the
    // branch only guards a row vanishing between the two reads. Simulate it.
    vi.spyOn(hub.repository, "getRoomState").mockReturnValue(undefined);

    const response = await request(hub.app.server)
      .post("/api/hub/rooms/room-x/agents")
      .send({ agentId: "room-agent" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Room state not found" });
    expect(hub.relayClient.roomCas).not.toHaveBeenCalled();
  });

  it("returns 503 when the local User key is unavailable", async () => {
    const hub = await startRoomsHub(database, apps);
    createRoomConversation(hub.repository, { relayRoomId: "room-x" });
    // getCredential has no value cache, so deleting the key from the (file)
    // credential store makes the route's getUserKey() miss.
    await deleteCredential(USER_KEY_IDENTIFIER);

    const response = await request(hub.app.server)
      .post("/api/hub/rooms/room-x/agents")
      .send({ agentId: "room-agent" });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "Local User key is unavailable" });
  });

  it("coordinates an accepted relay CAS, commits counters and returns a verifiable OwnerProof", async () => {
    const hub = await startRoomsHub(database, apps, {
      state: "connected",
      roomCas: vi.fn().mockResolvedValue({ revision: 2, keyEpoch: 1, accepted: true }),
    });
    const conversation = createRoomConversation(hub.repository, { relayRoomId: "room-x" });

    const response = await request(hub.app.server)
      .post("/api/hub/rooms/room-x/agents")
      .send({ agentId: "  room-agent  " });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.agentId).toBe("room-agent");
    expect(hub.relayClient.roomCas).toHaveBeenCalledTimes(1);
    expect(hub.relayClient.roomCas).toHaveBeenCalledWith(
      "room-x",
      { revision: 1, keyEpoch: 1 },
      { revision: 2, keyEpoch: 1 },
    );
    expect(hub.relayClient.joinRoom).not.toHaveBeenCalled();
    expect(hub.repository.getRoomState("room-x")).toEqual({
      revision: 2,
      keyEpoch: 1,
      managementState: "managed",
    });

    const proof = response.body.ownerProof;
    expect(isOwnerProof(proof)).toBe(true);
    expect(proof).toMatchObject({
      agentId: "room-agent",
      ownerId: "usr_local",
      roomId: "room-x",
      keyEpoch: 1,
    });
    expect(typeof proof.signature).toBe("string");
    expect(proof.signature.length).toBeGreaterThan(0);
    expect(verifyOwnerProof(proof, userKeyPair.publicKey, 1)).toBe(true);
    // Proofs are bound to the epoch they were minted for.
    expect(verifyOwnerProof(proof, userKeyPair.publicKey, 2)).toBe(false);

    expect(
      hub.repository.getConversationMembers(conversation.id).map((member) => member.id),
    ).toEqual(["room-agent"]);
    expect(
      JSON.parse(
        hub.repository.getConversationAgentOwnerProof(conversation.id, "room-agent") ?? "null",
      ),
    ).toEqual(proof);
  });

  it("resyncs with 409 ROOM_STATE_CONFLICT when the relay rejects the CAS proposal", async () => {
    const hub = await startRoomsHub(database, apps, {
      state: "connected",
      roomCas: vi.fn().mockResolvedValue({ revision: 9, keyEpoch: 4, accepted: false }),
    });
    const conversation = createRoomConversation(hub.repository, { relayRoomId: "room-x" });

    const response = await request(hub.app.server)
      .post("/api/hub/rooms/room-x/agents")
      .send({ agentId: "room-agent" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "ROOM_STATE_CONFLICT", revision: 9, keyEpoch: 4 });
    expect(hub.relayClient.roomCas).toHaveBeenCalledTimes(1);
    expect(hub.relayClient.joinRoom).toHaveBeenCalledWith("room-x");
    expect(hub.repository.getConversationMembers(conversation.id)).toEqual([]);
    expect(hub.repository.getRoomState("room-x")).toEqual({
      revision: 1,
      keyEpoch: 1,
      managementState: "managed",
    });
  });

  it("rolls the accepted CAS counters back when the local membership write fails", async () => {
    const hub = await startRoomsHub(database, apps, {
      state: "connected",
      roomCas: vi.fn().mockResolvedValue({ revision: 4, keyEpoch: 2, accepted: true }),
    });
    const conversation = createRoomConversation(hub.repository, { relayRoomId: "room-x" });
    hub.repository.setRoomCounters("room-x", { revision: 3, keyEpoch: 2 });
    // addAgentToConversation only fails when a row vanished between the route's
    // lookups and the write; simulate that local failure.
    vi.spyOn(hub.repository, "addAgentToConversation").mockReturnValueOnce(undefined);

    const response = await request(hub.app.server)
      .post("/api/hub/rooms/room-x/agents")
      .send({ agentId: "room-agent" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Room or Agent not found" });
    expect(hub.relayClient.roomCas).toHaveBeenNthCalledWith(
      1,
      "room-x",
      { revision: 3, keyEpoch: 2 },
      { revision: 4, keyEpoch: 2 },
    );
    expect(hub.relayClient.roomCas).toHaveBeenNthCalledWith(
      2,
      "room-x",
      { revision: 4, keyEpoch: 2 },
      { revision: 5, keyEpoch: 2 },
    );
    expect(hub.repository.getRoomState("room-x")).toEqual({
      revision: 5,
      keyEpoch: 2,
      managementState: "managed",
    });
    expect(hub.repository.getConversationMembers(conversation.id)).toEqual([]);
  });

  it("adds the Agent locally without CAS while the relay is disconnected", async () => {
    const hub = await startRoomsHub(database, apps);
    const conversation = createRoomConversation(hub.repository, { relayRoomId: "room-x" });

    const response = await request(hub.app.server)
      .post("/api/hub/rooms/room-x/agents")
      .send({ agentId: "room-agent" });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.agentId).toBe("room-agent");
    expect(hub.relayClient.roomCas).not.toHaveBeenCalled();
    expect(verifyOwnerProof(response.body.ownerProof, userKeyPair.publicKey, 1)).toBe(true);
    expect(
      hub.repository.getConversationMembers(conversation.id).map((member) => member.id),
    ).toEqual(["room-agent"]);
    expect(hub.repository.getRoomState("room-x")).toEqual({
      revision: 1,
      keyEpoch: 1,
      managementState: "managed",
    });
  });
});

describe("DELETE /api/hub/rooms/:id/agents/:agentId", () => {
  it("returns 404 for an unknown room or a non-member Agent", async () => {
    const hub = await startRoomsHub(database, apps);
    const conversation = createRoomConversation(hub.repository, { relayRoomId: "room-x" });
    hub.repository.addAgentToConversation(conversation.id, ["room-agent"]);

    const missingRoom = await request(hub.app.server).delete(
      "/api/hub/rooms/room-missing/agents/room-agent",
    );
    expect(missingRoom.status).toBe(404);
    expect(missingRoom.body).toEqual({ error: "Room not found" });

    const missingMember = await request(hub.app.server).delete(
      "/api/hub/rooms/room-x/agents/ghost-agent",
    );
    expect(missingMember.status).toBe(404);
    expect(missingMember.body).toEqual({ error: "Room Agent not found" });
  });

  it("allows the Agent owner and bumps local counters while disconnected", async () => {
    const hub = await startRoomsHub(database, apps);
    // Created by another hub: only the ownership path authorizes this removal.
    const conversation = createRoomConversation(hub.repository, {
      relayRoomId: "room-x",
      createdByHubId: "hub-other",
    });
    hub.repository.addAgentToConversation(conversation.id, ["room-agent"]);

    const response = await request(hub.app.server).delete(
      "/api/hub/rooms/room-x/agents/room-agent",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(hub.relayClient.roomCas).not.toHaveBeenCalled();
    expect(hub.repository.getConversationMembers(conversation.id)).toEqual([]);
    // incrementRoomRevision: revision 1→2; incrementRoomKeyEpoch additionally
    // bumps the revision again while rotating the epoch: revision 2→3, keyEpoch 1→2.
    expect(hub.repository.getRoomState("room-x")).toEqual({
      revision: 3,
      keyEpoch: 2,
      managementState: "managed",
    });
  });

  it("allows a local room administrator even when the Agent is owned elsewhere", async () => {
    const hub = await startRoomsHub(database, apps);
    const conversation = createRoomConversation(hub.repository, { relayRoomId: "room-x" });
    hub.repository.addAgentToConversation(conversation.id, ["remote-agent"]);

    const response = await request(hub.app.server).delete(
      "/api/hub/rooms/room-x/agents/remote-agent",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(hub.repository.getConversationMembers(conversation.id)).toEqual([]);
  });

  it("falls back to the relay room creator when the local user is neither owner nor admin", async () => {
    const hub = await startRoomsHub(database, apps, {
      state: "connected",
      getRoomRequest: vi.fn().mockResolvedValue(roomInfo({ createdBy: "hub-local" })),
      roomCas: vi.fn().mockResolvedValue({ revision: 2, keyEpoch: 2, accepted: true }),
    });
    const conversation = createRoomConversation(hub.repository, {
      relayRoomId: "room-x",
      createdByHubId: "hub-other",
    });
    hub.repository.addAgentToConversation(conversation.id, ["remote-agent"]);

    const response = await request(hub.app.server).delete(
      "/api/hub/rooms/room-x/agents/remote-agent",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(hub.relayClient.getRoomRequest).toHaveBeenCalledWith(RELAY_URL, "room-x");
    expect(hub.repository.getConversationMembers(conversation.id)).toEqual([]);
    expect(hub.repository.getRoomState("room-x")).toEqual({
      revision: 2,
      keyEpoch: 2,
      managementState: "managed",
    });
  });

  it("rejects with ROOM_ADMIN_REQUIRED when the relay creator is a different hub", async () => {
    const hub = await startRoomsHub(database, apps, {
      state: "connected",
      getRoomRequest: vi.fn().mockResolvedValue(roomInfo({ createdBy: "hub-elsewhere" })),
    });
    const conversation = createRoomConversation(hub.repository, {
      relayRoomId: "room-x",
      createdByHubId: "hub-other",
    });
    hub.repository.addAgentToConversation(conversation.id, ["remote-agent"]);

    const response = await request(hub.app.server).delete(
      "/api/hub/rooms/room-x/agents/remote-agent",
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "ROOM_ADMIN_REQUIRED" });
    expect(hub.relayClient.roomCas).not.toHaveBeenCalled();
    expect(
      hub.repository.getConversationMembers(conversation.id).map((member) => member.id),
    ).toEqual(["remote-agent"]);
  });

  it("rejects with ROOM_ADMIN_REQUIRED when the relay client cannot fetch the room", async () => {
    const hub = await startRoomsHub(database, apps, { getRoomRequest: undefined });
    const conversation = createRoomConversation(hub.repository, {
      relayRoomId: "room-x",
      createdByHubId: "hub-other",
    });
    hub.repository.addAgentToConversation(conversation.id, ["remote-agent"]);

    const response = await request(hub.app.server).delete(
      "/api/hub/rooms/room-x/agents/remote-agent",
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "ROOM_ADMIN_REQUIRED" });
    expect(hub.repository.getConversationMembers(conversation.id)).toHaveLength(1);
  });

  it("rotates the key epoch through an accepted CAS on removal", async () => {
    const hub = await startRoomsHub(database, apps, {
      state: "connected",
      roomCas: vi.fn().mockResolvedValue({ revision: 2, keyEpoch: 2, accepted: true }),
    });
    const conversation = createRoomConversation(hub.repository, { relayRoomId: "room-x" });
    hub.repository.addAgentToConversation(conversation.id, ["room-agent"]);

    const response = await request(hub.app.server).delete(
      "/api/hub/rooms/room-x/agents/room-agent",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(hub.relayClient.roomCas).toHaveBeenCalledWith(
      "room-x",
      { revision: 1, keyEpoch: 1 },
      { revision: 2, keyEpoch: 2 },
    );
    expect(hub.repository.getConversationMembers(conversation.id)).toEqual([]);
    expect(hub.repository.getRoomState("room-x")).toEqual({
      revision: 2,
      keyEpoch: 2,
      managementState: "managed",
    });
  });

  it("rejects the removal with 409 when the CAS loses the race", async () => {
    const hub = await startRoomsHub(database, apps, {
      state: "connected",
      roomCas: vi.fn().mockResolvedValue({ revision: 8, keyEpoch: 5, accepted: false }),
    });
    const conversation = createRoomConversation(hub.repository, { relayRoomId: "room-x" });
    hub.repository.addAgentToConversation(conversation.id, ["room-agent"]);

    const response = await request(hub.app.server).delete(
      "/api/hub/rooms/room-x/agents/room-agent",
    );

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "ROOM_STATE_CONFLICT", revision: 8, keyEpoch: 5 });
    expect(hub.relayClient.joinRoom).toHaveBeenCalledWith("room-x");
    expect(
      hub.repository.getConversationMembers(conversation.id).map((member) => member.id),
    ).toEqual(["room-agent"]);
    expect(hub.repository.getRoomState("room-x")).toEqual({
      revision: 1,
      keyEpoch: 1,
      managementState: "managed",
    });
  });

  it("returns 404 when the membership removal fails", async () => {
    const hub = await startRoomsHub(database, apps);
    const conversation = createRoomConversation(hub.repository, { relayRoomId: "room-x" });
    hub.repository.addAgentToConversation(conversation.id, ["room-agent"]);
    // removeAgentsFromConversation only fails when the conversation vanished
    // between the route's lookup and the write; simulate that local failure.
    vi.spyOn(hub.repository, "removeAgentFromConversation").mockReturnValueOnce(undefined);

    const response = await request(hub.app.server).delete(
      "/api/hub/rooms/room-x/agents/room-agent",
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Room not found" });
  });
});
