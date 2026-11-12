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

const RELAY_URL = "ws://relay.invalid";

function makeInvitation(overrides: Partial<RoomInvitation> = {}): RoomInvitation {
  return {
    roomId: "room-1",
    roomName: "Room One",
    inviteeHubId: "hub-local",
    invitedByHubId: "hub-owner",
    invitedByName: "Owner Hub",
    status: "pending",
    createdAt: 1_000,
    expiresAt: 61_000,
    ...overrides,
  };
}

function makeRoom(invitation: RoomInvitation): RoomInfo {
  return {
    id: invitation.roomId,
    name: invitation.roomName,
    createdBy: invitation.invitedByHubId,
    createdAt: invitation.createdAt,
    members: [],
  };
}

describe("Hub room invitation routes", () => {
  let app: ReturnType<typeof Fastify>;
  let database: DatabaseContext;
  let repository: Repository;
  let relayClient: {
    state: string;
    listRoomInvitationsRequest: ReturnType<typeof vi.fn>;
    respondToRoomInvitationRequest: ReturnType<typeof vi.fn>;
    inviteToRoomRequest: ReturnType<typeof vi.fn>;
    joinRoom: ReturnType<typeof vi.fn>;
    onRoomMembers: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    database = createDatabase(":memory:");
    app = Fastify({ logger: false });
    repository = new Repository(database);
    relayClient = {
      state: "connected",
      listRoomInvitationsRequest: vi.fn().mockResolvedValue([]),
      respondToRoomInvitationRequest: vi.fn(),
      inviteToRoomRequest: vi.fn(),
      joinRoom: vi.fn(),
      onRoomMembers: vi.fn(() => () => undefined),
    };
    const registry = new AgentRegistry(repository);
    await registry.initialize([]);
    const listener = new P2PListener();
    const connectionManager = new ConnectionManager(
      listener,
      relayClient as unknown as RelayClient,
    );
    const hubConfig: HubConfig = {
      enabled: true,
      displayName: "Local Hub",
      relay: { url: RELAY_URL },
      p2p: { enabled: false, port: 3212, discovery: "none" },
    };
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
  });

  afterEach(async () => {
    await app.close();
    database.sqlite.close();
  });

  describe("POST /api/hub/rooms/:id/invite", () => {
    it.each([
      ["missing", {}],
      ["empty", { hubId: "" }],
      ["whitespace-only", { hubId: "   " }],
      ["non-string", { hubId: 42 }],
    ])("rejects a %s hubId with 400", async (_label, body) => {
      const response = await request(app.server).post("/api/hub/rooms/room-1/invite").send(body);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: "hubId must be a non-empty string" });
      expect(relayClient.inviteToRoomRequest).not.toHaveBeenCalled();
    });

    it("forwards a trimmed hubId to the Relay and returns the invitation", async () => {
      const invitation = makeInvitation({ inviteeHubId: "hub-peer" });
      relayClient.inviteToRoomRequest.mockResolvedValue(invitation);

      const response = await request(app.server)
        .post("/api/hub/rooms/room-1/invite")
        .send({ hubId: "  hub-peer  " });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true, invitation });
      expect(relayClient.inviteToRoomRequest).toHaveBeenCalledWith(RELAY_URL, "room-1", "hub-peer");
    });
  });

  describe("GET /api/hub/room-invitations", () => {
    it("returns pending and unmaterialised accepted invitations only", async () => {
      const pending = makeInvitation({ roomId: "room-pending" });
      const acceptedOrphan = makeInvitation({ roomId: "room-orphan", status: "accepted" });
      const acceptedJoined = makeInvitation({ roomId: "room-joined", status: "accepted" });
      const declined = makeInvitation({ roomId: "room-declined", status: "declined" });
      const revoked = makeInvitation({ roomId: "room-revoked", status: "revoked" });
      const expired = makeInvitation({ roomId: "room-expired", status: "expired" });
      repository.createConversation("Joined", "cross_hub", [], "room-joined", {
        createdByHubId: "hub-owner",
        adminHubIds: ["hub-owner"],
      });
      relayClient.listRoomInvitationsRequest.mockResolvedValue([
        pending,
        acceptedOrphan,
        acceptedJoined,
        declined,
        revoked,
        expired,
      ]);

      const response = await request(app.server).get("/api/hub/room-invitations");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ invitations: [pending, acceptedOrphan] });
      expect(relayClient.listRoomInvitationsRequest).toHaveBeenCalledWith(RELAY_URL);
    });
  });

  describe("POST /api/hub/room-invitations/:id/accept", () => {
    it("creates a cross_hub conversation from the Relay room and joins it", async () => {
      const invitation = makeInvitation({ status: "accepted", respondedAt: 2_000 });
      relayClient.respondToRoomInvitationRequest.mockResolvedValue({
        invitation,
        room: makeRoom(invitation),
      });

      const response = await request(app.server).post("/api/hub/room-invitations/room-1/accept");

      expect(response.status).toBe(200);
      expect(response.body.invitation).toEqual(invitation);
      expect(response.body.conversation).toMatchObject({
        title: "Room One",
        type: "cross_hub",
        relayRoomId: "room-1",
      });
      expect(relayClient.respondToRoomInvitationRequest).toHaveBeenCalledWith(
        RELAY_URL,
        "room-1",
        "accepted",
      );
      expect(relayClient.joinRoom).toHaveBeenCalledWith("room-1");
      const conversations = repository.listConversations({ type: "cross_hub" });
      expect(conversations).toHaveLength(1);
      expect(conversations[0]?.id).toBe(response.body.conversation.id);
    });

    it("returns 502 without creating or joining when the Relay omits the room", async () => {
      const invitation = makeInvitation({ status: "accepted", respondedAt: 2_000 });
      relayClient.respondToRoomInvitationRequest.mockResolvedValue({ invitation });

      const response = await request(app.server).post("/api/hub/room-invitations/room-1/accept");

      expect(response.status).toBe(502);
      expect(response.body).toEqual({ error: "Relay did not return the accepted Room" });
      expect(repository.listConversations({ type: "cross_hub" })).toEqual([]);
      expect(relayClient.joinRoom).not.toHaveBeenCalled();
    });

    it("reuses an existing room conversation but still joins the room", async () => {
      const existing = repository.createConversation("Existing", "cross_hub", [], "room-1", {
        createdByHubId: "hub-owner",
        adminHubIds: ["hub-owner"],
      });
      const invitation = makeInvitation({ status: "accepted", respondedAt: 2_000 });
      relayClient.respondToRoomInvitationRequest.mockResolvedValue({ invitation });
      const createConversation = vi.spyOn(repository, "createConversation");

      const response = await request(app.server).post("/api/hub/room-invitations/room-1/accept");

      expect(response.status).toBe(200);
      expect(response.body.invitation).toEqual(invitation);
      expect(response.body.conversation).toMatchObject({ id: existing.id, title: "Existing" });
      expect(createConversation).not.toHaveBeenCalled();
      expect(repository.listConversations({ type: "cross_hub" })).toHaveLength(1);
      expect(relayClient.joinRoom).toHaveBeenCalledWith("room-1");
    });
  });

  describe("POST /api/hub/room-invitations/:id/decline", () => {
    it("declines through the Relay and returns only the invitation", async () => {
      const invitation = makeInvitation({ status: "declined", respondedAt: 2_000 });
      relayClient.respondToRoomInvitationRequest.mockResolvedValue({
        invitation,
        room: makeRoom(invitation),
      });

      const response = await request(app.server).post("/api/hub/room-invitations/room-1/decline");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ invitation });
      expect(relayClient.respondToRoomInvitationRequest).toHaveBeenCalledWith(
        RELAY_URL,
        "room-1",
        "declined",
      );
      expect(relayClient.joinRoom).not.toHaveBeenCalled();
      expect(repository.listConversations({ type: "cross_hub" })).toEqual([]);
    });
  });
});
