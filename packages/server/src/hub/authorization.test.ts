import type { HubPayload } from "@chorus/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseContext } from "../db/index.js";
import { Repository } from "../db/repository.js";
import type { AgentRegistry } from "../agent/registry.js";
import { AuthorizationService } from "./authorization.js";
import { TrustStore } from "./trust-store.js";

const databases: DatabaseContext[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.sqlite.close();
});

describe("Hub authorization", () => {
  it("rejects directory requests while pairing is still pending", () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    const trustStore = new TrustStore(repository);
    trustStore.addPending("hub-pending");
    const service = new AuthorizationService(trustStore, repository);
    const payload: HubPayload = {
      protocolVersion: 2,
      messageType: "directory_request",
      messageId: "directory-request-1",
      fromUserId: "usr_remote",
      fromUserName: "Remote User",
    };

    expect(service.authorize("hub-pending", payload)).toEqual({
      allowed: false,
      reason: "Hub pairing is incomplete",
    });
  });

  it("requires a cross-Hub Room and current sender membership for chat", async () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    const repository = new Repository(database);
    await repository.getOrCreateLocalUser("Local User");
    const trustStore = new TrustStore(repository);
    trustStore.completePairing("hub-remote", {
      userId: "usr_remote",
      userName: "Remote User",
      userPublicKey: "remote-user-key",
    });
    const payload: HubPayload = {
      protocolVersion: 2,
      messageType: "chat",
      conversationId: "room-wire-id",
      messageId: "chat-1",
      fromUserId: "usr_remote",
      fromUserName: "Remote User",
      content: "Hello",
    };
    const absentRegistry = {
      isHubInRoom: () => false,
    } as unknown as AgentRegistry;
    const absent = new AuthorizationService(trustStore, repository, absentRegistry);

    expect(absent.authorize("hub-remote", payload)).toEqual({
      allowed: false,
      reason: "Cross-Hub Room membership is required",
    });

    repository.createConversation("Shared Room", "cross_hub", [], "room-wire-id");
    expect(absent.authorize("hub-remote", payload)).toEqual({
      allowed: false,
      reason: "Sender Hub is not a current Room member",
    });

    const memberRegistry = {
      isHubInRoom: (roomId: string, hubId: string) =>
        roomId === "room-wire-id" && hubId === "hub-remote",
    } as unknown as AgentRegistry;
    const member = new AuthorizationService(trustStore, repository, memberRegistry);
    expect(member.authorize("hub-remote", payload)).toEqual({ allowed: true });
  });

  describe("resync", () => {
    it("rejects resync messages without a Room id", async () => {
      const { service } = await setupAuthorization(memberRegistry);

      expect(service.authorize("hub-remote", resyncRequest(""))).toEqual({
        allowed: false,
        reason: "Resync message has no Room id",
      });
      expect(
        service.authorize("hub-remote", {
          ...basePayload("resync_response", "resync-response-1"),
        }),
      ).toEqual({ allowed: false, reason: "Resync message has no Room id" });
    });

    it("rejects resync for an unknown Room or a Room without a relay id", async () => {
      const { service, repository } = await setupAuthorization(memberRegistry);

      expect(service.authorize("hub-remote", resyncRequest("room-wire-id"))).toEqual({
        allowed: false,
        reason: "Sender Hub is not a member of the resync Room",
      });

      const localOnly = repository.createConversation("Local Only", "cross_hub");
      expect(service.authorize("hub-remote", resyncRequest(localOnly.id))).toEqual({
        allowed: false,
        reason: "Sender Hub is not a member of the resync Room",
      });
    });

    it("rejects resync from a Hub that is not a Room member", async () => {
      const { service, repository } = await setupAuthorization(absentRegistry);
      repository.createConversation("Shared Room", "cross_hub", [], "room-wire-id");

      expect(service.authorize("hub-remote", resyncRequest("room-wire-id"))).toEqual({
        allowed: false,
        reason: "Sender Hub is not a member of the resync Room",
      });
    });

    it("rejects resync when no registry is available", async () => {
      const { service, repository } = await setupAuthorization();
      repository.createConversation("Shared Room", "cross_hub", [], "room-wire-id");

      expect(service.authorize("hub-remote", resyncRequest("room-wire-id"))).toEqual({
        allowed: false,
        reason: "Sender Hub is not a member of the resync Room",
      });
    });

    it("allows resync requests and responses from Room members by relay or local id", async () => {
      const { service, repository } = await setupAuthorization(memberRegistry);
      const room = repository.createConversation("Shared Room", "cross_hub", [], "room-wire-id");

      expect(service.authorize("hub-remote", resyncRequest("room-wire-id"))).toEqual({
        allowed: true,
      });
      expect(service.authorize("hub-remote", resyncRequest(room.id))).toEqual({ allowed: true });
      expect(
        service.authorize("hub-remote", {
          ...basePayload("resync_response", "resync-response-1"),
          resyncResponse: {
            roomId: "room-wire-id",
            currentRevision: 1,
            currentKeyEpoch: 1,
            missedEvents: [],
            snapshot: { revision: 1, keyEpoch: 1, managementState: "managed" },
          },
        }),
      ).toEqual({ allowed: true });
    });

    it("checks resync_response membership against resyncResponse.roomId only", async () => {
      const { service, repository } = await setupAuthorization(memberRegistry);
      repository.createConversation("Shared Room", "cross_hub", [], "room-wire-id");
      repository.createConversation("Other Room", "cross_hub", [], "room-other-id");

      expect(
        service.authorize("hub-remote", {
          ...resyncResponse("room-other-id"),
          resyncRequest: { roomId: "room-wire-id", lastKnownRevision: 0, lastKnownKeyEpoch: 0 },
        }),
      ).toEqual({ allowed: false, reason: "Sender Hub is not a member of the resync Room" });
      expect(
        service.authorize("hub-remote", {
          ...basePayload("resync_response", "resync-response-1"),
          resyncRequest: { roomId: "room-wire-id", lastKnownRevision: 0, lastKnownKeyEpoch: 0 },
        }),
      ).toEqual({ allowed: false, reason: "Resync message has no Room id" });
      expect(
        service.authorize("hub-remote", {
          ...resyncResponse("room-wire-id"),
          resyncRequest: { roomId: "room-other-id", lastKnownRevision: 0, lastKnownKeyEpoch: 0 },
        }),
      ).toEqual({ allowed: true });
    });

    it("checks resync_request membership against resyncRequest.roomId only", async () => {
      const { service, repository } = await setupAuthorization(memberRegistry);
      repository.createConversation("Shared Room", "cross_hub", [], "room-wire-id");
      repository.createConversation("Other Room", "cross_hub", [], "room-other-id");

      expect(
        service.authorize("hub-remote", {
          ...resyncRequest("room-other-id"),
          resyncResponse: resyncResponse("room-wire-id").resyncResponse,
        }),
      ).toEqual({ allowed: false, reason: "Sender Hub is not a member of the resync Room" });
      expect(
        service.authorize("hub-remote", {
          ...basePayload("resync_request", "resync-request-1"),
          resyncResponse: resyncResponse("room-wire-id").resyncResponse,
        }),
      ).toEqual({ allowed: false, reason: "Resync message has no Room id" });
      expect(
        service.authorize("hub-remote", {
          ...resyncRequest("room-wire-id"),
          resyncResponse: resyncResponse("room-other-id").resyncResponse,
        }),
      ).toEqual({ allowed: true });
    });
  });

  describe("target agent", () => {
    it("rejects a2a calls to an unknown agent", async () => {
      const { service, repository } = await setupAuthorization(memberRegistry);
      repository.createConversation("Shared Room", "cross_hub", [], "room-wire-id");

      expect(service.authorize("hub-remote", a2aCall("agent-missing"))).toEqual({
        allowed: false,
        reason: "Target agent not found",
      });
    });

    it("rejects a2a calls to a remote agent", async () => {
      const { service, repository } = await setupAuthorization(memberRegistry);
      addAgent(repository, "agent-remote", { ownerType: "remote", visibility: "room" });
      repository.createConversation("Shared Room", "cross_hub", ["agent-remote"], "room-wire-id");

      expect(service.authorize("hub-remote", a2aCall("agent-remote"))).toEqual({
        allowed: false,
        reason: "Cannot call remote agent via inbound",
      });
    });

    it("rejects a2a calls to a disabled agent", async () => {
      const { service, repository } = await setupAuthorization(memberRegistry);
      addAgent(repository, "agent-disabled", { disabled: true, visibility: "room" });
      repository.createConversation("Shared Room", "cross_hub", ["agent-disabled"], "room-wire-id");

      expect(service.authorize("hub-remote", a2aCall("agent-disabled"))).toEqual({
        allowed: false,
        reason: "Target agent is disabled",
      });
    });

    it("rejects a2a calls to an agent that is not admitted to the Room", async () => {
      const { service, repository } = await setupAuthorization(memberRegistry);
      addAgent(repository, "agent-outside", { visibility: "public" });
      repository.createConversation("Shared Room", "cross_hub", [], "room-wire-id");

      expect(service.authorize("hub-remote", a2aCall("agent-outside"))).toEqual({
        allowed: false,
        reason: "Target agent is not admitted to the Room",
      });
    });

    it("rejects a2a calls to a private Room member", async () => {
      const { service, repository } = await setupAuthorization(memberRegistry);
      addAgent(repository, "agent-private", { visibility: "private" });
      repository.createConversation("Shared Room", "cross_hub", ["agent-private"], "room-wire-id");

      expect(service.authorize("hub-remote", a2aCall("agent-private"))).toEqual({
        allowed: false,
        reason: "Target agent is private",
      });
    });

    it("allows a2a calls and chat to a visible, enabled Room member", async () => {
      const { service, repository } = await setupAuthorization(memberRegistry);
      addAgent(repository, "agent-room", { visibility: "room" });
      repository.createConversation("Shared Room", "cross_hub", ["agent-room"], "room-wire-id");

      expect(service.authorize("hub-remote", a2aCall("agent-room"))).toEqual({ allowed: true });
      expect(
        service.authorize("hub-remote", {
          ...basePayload("chat", "chat-1"),
          conversationId: "room-wire-id",
          toAgentId: "agent-room",
          content: "Hello",
        }),
      ).toEqual({ allowed: true });
    });

    it("reads the target agent from metadata when toAgentId is absent", async () => {
      const { service, repository } = await setupAuthorization(memberRegistry);
      addAgent(repository, "agent-private", { visibility: "private" });
      addAgent(repository, "agent-room", { visibility: "room" });
      repository.createConversation(
        "Shared Room",
        "cross_hub",
        ["agent-private", "agent-room"],
        "room-wire-id",
      );

      expect(
        service.authorize("hub-remote", a2aCall(undefined, { targetAgentId: "agent-private" })),
      ).toEqual({ allowed: false, reason: "Target agent is private" });
      expect(
        service.authorize("hub-remote", a2aCall(undefined, { targetAgentId: "agent-room" })),
      ).toEqual({ allowed: true });
    });

    it("prefers toAgentId over metadata targetAgentId", async () => {
      const { service, repository } = await setupAuthorization(memberRegistry);
      addAgent(repository, "agent-room", { visibility: "room" });
      repository.createConversation("Shared Room", "cross_hub", ["agent-room"], "room-wire-id");

      expect(
        service.authorize("hub-remote", a2aCall("agent-room", { targetAgentId: "agent-missing" })),
      ).toEqual({ allowed: true });
    });

    it("treats empty or non-string metadata targetAgentId as absent", async () => {
      const { service, repository } = await setupAuthorization(memberRegistry);
      repository.createConversation("Shared Room", "cross_hub", [], "room-wire-id");

      for (const targetAgentId of ["", 42, null, { id: "agent-missing" }]) {
        expect(service.authorize("hub-remote", a2aCall(undefined, { targetAgentId }))).toEqual({
          allowed: true,
        });
      }
      expect(
        service.authorize("hub-remote", a2aCall(undefined, { targetAgentId: "agent-missing" })),
      ).toEqual({ allowed: false, reason: "Target agent not found" });
    });
    it("treats an empty toAgentId as absent and falls back to metadata.targetAgentId", async () => {
      const { service, repository } = await setupAuthorization(memberRegistry);
      addAgent(repository, "agent-room", { visibility: "room" });
      repository.createConversation("Shared Room", "cross_hub", ["agent-room"], "room-wire-id");

      const emptyTarget = (messageId: string, metadata?: Record<string, unknown>): HubPayload => ({
        ...basePayload("chat", messageId),
        conversationId: "room-wire-id",
        toAgentId: "",
        content: "Hello",
        metadata,
      });

      expect(
        service.authorize(
          "hub-remote",
          emptyTarget("chat-empty-1", { targetAgentId: "agent-room" }),
        ),
      ).toEqual({ allowed: true });
      expect(
        service.authorize(
          "hub-remote",
          emptyTarget("chat-empty-2", { targetAgentId: "agent-missing" }),
        ),
      ).toEqual({ allowed: false, reason: "Target agent not found" });
      expect(service.authorize("hub-remote", emptyTarget("chat-empty-3"))).toEqual({
        allowed: true,
      });
    });
  });
});

const absentRegistry = {
  isHubInRoom: () => false,
} as unknown as AgentRegistry;

const memberRegistry = {
  isHubInRoom: (roomId: string, hubId: string) =>
    roomId === "room-wire-id" && hubId === "hub-remote",
} as unknown as AgentRegistry;

async function setupAuthorization(registry?: AgentRegistry): Promise<{
  repository: Repository;
  service: AuthorizationService;
}> {
  const database = createDatabase(":memory:");
  databases.push(database);
  const repository = new Repository(database);
  await repository.getOrCreateLocalUser("Local User");
  const trustStore = new TrustStore(repository);
  trustStore.completePairing("hub-remote", {
    userId: "usr_remote",
    userName: "Remote User",
    userPublicKey: "remote-user-key",
  });
  return { repository, service: new AuthorizationService(trustStore, repository, registry) };
}

function addAgent(
  repository: Repository,
  id: string,
  options: {
    disabled?: boolean;
    ownerType?: "local" | "remote" | "system";
    visibility?: "private" | "room" | "public";
  },
): void {
  repository.upsertAgent({
    id,
    name: id,
    type: "mock",
    config: {},
    disabled: options.disabled ?? false,
    ownerType: options.ownerType ?? "local",
    visibility: options.visibility,
  });
}

function basePayload(messageType: HubPayload["messageType"], messageId: string): HubPayload {
  return {
    protocolVersion: 2,
    messageType,
    messageId,
    fromUserId: "usr_remote",
    fromUserName: "Remote User",
  };
}

function resyncRequest(roomId: string): HubPayload {
  return {
    ...basePayload("resync_request", "resync-request-1"),
    resyncRequest: { roomId, lastKnownRevision: 0, lastKnownKeyEpoch: 0 },
  };
}

function resyncResponse(roomId: string): HubPayload {
  return {
    ...basePayload("resync_response", "resync-response-1"),
    resyncResponse: {
      roomId,
      currentRevision: 1,
      currentKeyEpoch: 1,
      missedEvents: [],
      snapshot: { revision: 1, keyEpoch: 1, managementState: "managed" },
    },
  };
}

function a2aCall(toAgentId?: string, metadata?: Record<string, unknown>): HubPayload {
  return {
    ...basePayload("a2a_call", "a2a-call-1"),
    conversationId: "room-wire-id",
    content: "Hello",
    ...(toAgentId ? { toAgentId } : {}),
    ...(metadata ? { metadata } : {}),
  };
}
