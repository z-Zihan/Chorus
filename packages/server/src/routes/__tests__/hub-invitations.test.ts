import type { HubConfig, RoomInfo, RoomInvitation } from "@chorus/shared";
import Fastify from "fastify";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRegistry } from "../../agent/registry.js";
import { createDatabase, type DatabaseContext } from "../../db/index.js";
import { Repository } from "../../db/repository.js";
import { ConnectionManager } from "../../hub/connection-manager.js";
import type { HubIdentity } from "../../hub/identity.js";
import { P2PListener } from "../../hub/p2p-listener.js";
import type { RelayClient } from "../../hub/relay-client.js";
import { registerHubRoutes } from "../hub.js";

describe("Room invitation recovery", () => {
  let app: ReturnType<typeof Fastify>;
  let database: DatabaseContext;

  beforeEach(() => {
    database = createDatabase(":memory:");
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
    database.sqlite.close();
  });

  it("retries local conversation creation after Relay membership was already accepted", async () => {
    const repository = new Repository(database);
    const invitation: RoomInvitation = {
      roomId: "room-recovery",
      roomName: "Recovery Room",
      inviteeHubId: "hub-local",
      invitedByHubId: "hub-owner",
      invitedByName: "Owner Hub",
      status: "accepted",
      createdAt: 1_000,
      expiresAt: 61_000,
      respondedAt: 2_000,
    };
    const room: RoomInfo = {
      id: invitation.roomId,
      name: invitation.roomName,
      createdBy: invitation.invitedByHubId,
      createdAt: invitation.createdAt,
      members: [],
    };
    const relayClient = {
      state: "connected",
      listRoomInvitationsRequest: vi.fn().mockResolvedValue([invitation]),
      respondToRoomInvitationRequest: vi.fn().mockResolvedValue({ invitation, room }),
      joinRoom: vi.fn(),
      onRoomMembers: vi.fn(() => () => undefined),
    } as unknown as RelayClient;
    const registry = new AgentRegistry(repository);
    await registry.initialize([]);
    const listener = new P2PListener();
    const connectionManager = new ConnectionManager(listener, relayClient);
    const hubConfig: HubConfig = {
      enabled: true,
      displayName: "Local Hub",
      relay: { url: "ws://relay.invalid" },
      p2p: { enabled: false, port: 3212, discovery: "none" },
    };
    registerHubRoutes(app, {
      identity: { hubId: "hub-local" } as HubIdentity,
      repository,
      relayClient,
      registry,
      connectionManager,
      hubConfig,
      connect: vi.fn(),
    });
    await app.ready();

    expect((await request(app.server).get("/api/hub/room-invitations")).body).toEqual({
      invitations: [invitation],
    });

    const createConversation = repository.createConversation.bind(repository);
    vi.spyOn(repository, "createConversation")
      .mockImplementationOnce(() => {
        throw new Error("simulated local database failure");
      })
      .mockImplementation(createConversation);

    expect(
      (await request(app.server).post(`/api/hub/room-invitations/${invitation.roomId}/accept`))
        .status,
    ).toBe(500);
    expect((await request(app.server).get("/api/hub/room-invitations")).body).toEqual({
      invitations: [invitation],
    });

    const recovered = await request(app.server).post(
      `/api/hub/room-invitations/${invitation.roomId}/accept`,
    );
    expect(recovered.status).toBe(200);
    expect(recovered.body.conversation).toMatchObject({
      title: invitation.roomName,
      relayRoomId: invitation.roomId,
      type: "cross_hub",
    });
    expect(repository.listConversations({ type: "cross_hub" })).toHaveLength(1);
    expect((await request(app.server).get("/api/hub/room-invitations")).body).toEqual({
      invitations: [],
    });
    expect(relayClient.respondToRoomInvitationRequest).toHaveBeenCalledTimes(2);
    expect(relayClient.joinRoom).toHaveBeenCalledTimes(1);
  });

  it("refuses to add a private Agent to a cross-Hub Room", async () => {
    const repository = new Repository(database);
    await repository.getOrCreateLocalUser("Local User");
    const registry = new AgentRegistry(repository);
    await registry.initialize([
      { id: "private-agent", name: "Private Agent", type: "mock", config: {} },
    ]);
    const conversation = repository.createConversation(
      "Private Room",
      "cross_hub",
      [],
      "room-private",
      { createdByHubId: "hub-local", adminHubIds: ["hub-local"] },
    );
    const relayClient = {
      state: "connected",
    } as unknown as RelayClient;
    const listener = new P2PListener();
    const connectionManager = new ConnectionManager(listener, relayClient);
    const hubConfig: HubConfig = {
      enabled: true,
      displayName: "Local Hub",
      relay: { url: "ws://relay.invalid" },
      p2p: { enabled: false, port: 3212, discovery: "none" },
    };
    registerHubRoutes(app, {
      identity: { hubId: "hub-local" } as HubIdentity,
      repository,
      relayClient,
      registry,
      connectionManager,
      hubConfig,
      connect: vi.fn(),
    });
    await app.ready();

    const response = await request(app.server)
      .post(`/api/hub/rooms/${conversation.id}/agents`)
      .send({ agentId: "private-agent" });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "AGENT_VISIBILITY_REQUIRED" });
    expect(repository.getConversationMembers(conversation.id)).toEqual([]);
  });
});
