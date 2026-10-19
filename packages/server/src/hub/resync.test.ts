import type {
  PersistedRoomState,
  ResyncRequestPayload,
  ResyncResponsePayload,
  RoomMember,
  RoomStateEvent,
} from "@chorus/shared";
import { describe, expect, it, vi } from "vitest";
import type { Repository } from "../db/repository.js";
import { generateUserKeyPair } from "../identity/user-keys.js";
import { createOwnerProof } from "./owner-proof.js";
import { MAX_INCREMENTAL_RESYNC_EVENTS, ResyncService } from "./resync.js";

function makeRepository(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getRoomState: vi.fn(),
    getRoomStateEvents: vi.fn(() => []),
    listRoomIds: vi.fn(() => []),
    saveRoomStateEvent: vi.fn(() => true),
    setRoomState: vi.fn((_roomId: string, state: PersistedRoomState) => state),
    ...overrides,
  } as unknown as Repository;
}

function makeRoomState(overrides: Partial<PersistedRoomState> = {}): PersistedRoomState {
  return { revision: 0, keyEpoch: 1, managementState: "managed", ...overrides };
}

function makeMember(hubId: string, overrides: Partial<RoomMember> = {}): RoomMember {
  return { hubId, publicKey: `${hubId}-key`, displayName: hubId, online: true, ...overrides };
}

function makeEvent(revision: number, overrides: Partial<RoomStateEvent> = {}): RoomStateEvent {
  return {
    eventId: `evt-${revision}`,
    roomId: "room-1",
    revision,
    keyEpoch: 1,
    eventType: "member_added",
    actorUserId: "usr_actor",
    actorSignature: "sig",
    timestamp: 1_000,
    data: {},
    ...overrides,
  };
}

describe("ResyncService.requestResync", () => {
  it("sends resync_request to online room members, excluding the local Hub", async () => {
    const repository = makeRepository({
      getRoomState: vi.fn(() => makeRoomState({ revision: 5, keyEpoch: 2 })),
    });
    const relay = {
      getOnlineRoomMembers: vi.fn(() => [
        makeMember("local-hub"),
        makeMember("hub-b"),
        makeMember("hub-c"),
      ]),
    };
    const send = vi.fn(async (_toHubId: string, _payload: unknown, _roomId: string) => undefined);
    const service = new ResyncService(repository, relay, send, "local-hub");

    await service.requestResync("room-1");

    expect(relay.getOnlineRoomMembers).toHaveBeenCalledWith("room-1");
    expect(send).toHaveBeenCalledTimes(2);
    const recipients = send.mock.calls.map((call) => call[0]);
    expect(recipients.sort()).toEqual(["hub-b", "hub-c"]);
    for (const call of send.mock.calls) {
      expect(call[1]).toMatchObject({
        messageType: "resync_request",
        conversationId: "room-1",
        resyncRequest: { roomId: "room-1", lastKnownRevision: 5, lastKnownKeyEpoch: 2 },
      });
      expect(call[2]).toBe("room-1");
    }
  });

  it("throws when the Room does not exist locally", async () => {
    const repository = makeRepository({ getRoomState: vi.fn(() => undefined) });
    const relay = { getOnlineRoomMembers: vi.fn(() => []) };
    const send = vi.fn();
    const service = new ResyncService(repository, relay, send);

    await expect(service.requestResync("missing-room")).rejects.toThrow("Room not found");
  });
});

describe("ResyncService.requestAllRooms", () => {
  it("requests resync for every room ID known to the repository", async () => {
    const states: Record<string, PersistedRoomState> = {
      "room-1": makeRoomState({ revision: 1 }),
      "room-2": makeRoomState({ revision: 2 }),
    };
    const repository = makeRepository({
      listRoomIds: vi.fn(() => ["room-1", "room-2"]),
      getRoomState: vi.fn((roomId: string) => states[roomId]),
    });
    const relay = { getOnlineRoomMembers: vi.fn(() => [makeMember("hub-b")]) };
    const send = vi.fn(async (_toHubId: string, _payload: unknown, _roomId: string) => undefined);
    const service = new ResyncService(repository, relay, send, "local-hub");

    await service.requestAllRooms();

    const requestedRooms = send.mock.calls.map((call) => call[2]);
    expect(requestedRooms.sort()).toEqual(["room-1", "room-2"]);
  });
});

describe("ResyncService.handleResyncRequest", () => {
  it("throws 'Invalid resync request' for a missing roomId", () => {
    const service = new ResyncService(makeRepository(), { getOnlineRoomMembers: vi.fn() }, vi.fn());
    const request = {
      roomId: "",
      lastKnownRevision: 0,
      lastKnownKeyEpoch: 1,
    } as ResyncRequestPayload;

    expect(() => service.handleResyncRequest(request)).toThrow("Invalid resync request");
  });

  it("throws 'Invalid resync request' for a negative lastKnownRevision", () => {
    const service = new ResyncService(makeRepository(), { getOnlineRoomMembers: vi.fn() }, vi.fn());
    const request: ResyncRequestPayload = {
      roomId: "room-1",
      lastKnownRevision: -1,
      lastKnownKeyEpoch: 1,
    };

    expect(() => service.handleResyncRequest(request)).toThrow("Invalid resync request");
  });

  it("throws 'Invalid resync request' for a keyEpoch below 1", () => {
    const service = new ResyncService(makeRepository(), { getOnlineRoomMembers: vi.fn() }, vi.fn());
    const request: ResyncRequestPayload = {
      roomId: "room-1",
      lastKnownRevision: 0,
      lastKnownKeyEpoch: 0,
    };

    expect(() => service.handleResyncRequest(request)).toThrow("Invalid resync request");
  });

  it("returns the snapshot with incremental missedEvents for a small, contiguous revision gap", () => {
    const events = [makeEvent(4), makeEvent(5)];
    const repository = makeRepository({
      getRoomState: vi.fn(() => makeRoomState({ revision: 5, keyEpoch: 1 })),
      getRoomStateEvents: vi.fn(() => events),
    });
    const service = new ResyncService(repository, { getOnlineRoomMembers: vi.fn() }, vi.fn());
    const request: ResyncRequestPayload = {
      roomId: "room-1",
      lastKnownRevision: 3,
      lastKnownKeyEpoch: 1,
    };

    const response = service.handleResyncRequest(request);

    expect(repository.getRoomStateEvents).toHaveBeenCalledWith(
      "room-1",
      3,
      MAX_INCREMENTAL_RESYNC_EVENTS + 1,
    );
    expect(response.missedEvents).toEqual(events);
    expect(response.currentRevision).toBe(5);
    expect(response.snapshot).toEqual(makeRoomState({ revision: 5, keyEpoch: 1 }));
  });

  it("falls back to snapshot-only (empty missedEvents) when the gap exceeds the incremental cap", () => {
    const repository = makeRepository({
      getRoomState: vi.fn(() =>
        makeRoomState({ revision: MAX_INCREMENTAL_RESYNC_EVENTS + 50, keyEpoch: 1 }),
      ),
    });
    const service = new ResyncService(repository, { getOnlineRoomMembers: vi.fn() }, vi.fn());
    const request: ResyncRequestPayload = {
      roomId: "room-1",
      lastKnownRevision: 0,
      lastKnownKeyEpoch: 1,
    };

    const response = service.handleResyncRequest(request);

    expect(response.missedEvents).toEqual([]);
    expect(repository.getRoomStateEvents).not.toHaveBeenCalled();
  });

  it("returns empty missedEvents when the fetched events are not a contiguous, complete range", () => {
    const repository = makeRepository({
      getRoomState: vi.fn(() => makeRoomState({ revision: 5, keyEpoch: 1 })),
      // Gap is 2 (revisions 4 and 5) but only revision 5 came back: incomplete.
      getRoomStateEvents: vi.fn(() => [makeEvent(5)]),
    });
    const service = new ResyncService(repository, { getOnlineRoomMembers: vi.fn() }, vi.fn());
    const request: ResyncRequestPayload = {
      roomId: "room-1",
      lastKnownRevision: 3,
      lastKnownKeyEpoch: 1,
    };

    const response = service.handleResyncRequest(request);

    expect(response.missedEvents).toEqual([]);
  });

  it("returns empty missedEvents with no gap (already up to date)", () => {
    const repository = makeRepository({
      getRoomState: vi.fn(() => makeRoomState({ revision: 3, keyEpoch: 1 })),
    });
    const service = new ResyncService(repository, { getOnlineRoomMembers: vi.fn() }, vi.fn());
    const request: ResyncRequestPayload = {
      roomId: "room-1",
      lastKnownRevision: 3,
      lastKnownKeyEpoch: 1,
    };

    const response = service.handleResyncRequest(request);

    expect(response.missedEvents).toEqual([]);
  });
});

describe("ResyncService.handleResyncResponse", () => {
  it("throws 'Invalid resync response' when the snapshot revision does not match currentRevision", () => {
    const service = new ResyncService(makeRepository(), { getOnlineRoomMembers: vi.fn() }, vi.fn());
    const response: ResyncResponsePayload = {
      roomId: "room-1",
      currentRevision: 5,
      currentKeyEpoch: 1,
      missedEvents: [],
      snapshot: makeRoomState({ revision: 1, keyEpoch: 1 }),
    };

    expect(() => service.handleResyncResponse(response)).toThrow("Invalid resync response");
  });

  it("returns false and applies nothing when the response revision is not newer", () => {
    const repository = makeRepository({
      getRoomState: vi.fn(() => makeRoomState({ revision: 5, keyEpoch: 1 })),
    });
    const service = new ResyncService(repository, { getOnlineRoomMembers: vi.fn() }, vi.fn());
    const response: ResyncResponsePayload = {
      roomId: "room-1",
      currentRevision: 5,
      currentKeyEpoch: 1,
      missedEvents: [],
      snapshot: makeRoomState({ revision: 5, keyEpoch: 1 }),
    };

    const result = service.handleResyncResponse(response);

    expect(result).toBe(false);
    expect(repository.setRoomState).not.toHaveBeenCalled();
    expect(repository.saveRoomStateEvent).not.toHaveBeenCalled();
  });

  it("applies contiguous missedEvents via saveRoomStateEvent then setRoomState, returning true", () => {
    const repository = makeRepository({
      getRoomState: vi.fn(() => makeRoomState({ revision: 0, keyEpoch: 1 })),
    });
    const service = new ResyncService(repository, { getOnlineRoomMembers: vi.fn() }, vi.fn());
    const missedEvents = [makeEvent(1), makeEvent(2)];
    const snapshot = makeRoomState({ revision: 2, keyEpoch: 1 });
    const response: ResyncResponsePayload = {
      roomId: "room-1",
      currentRevision: 2,
      currentKeyEpoch: 1,
      missedEvents,
      snapshot,
    };

    const result = service.handleResyncResponse(response);

    expect(result).toBe(true);
    expect(repository.saveRoomStateEvent).toHaveBeenCalledTimes(2);
    expect(repository.saveRoomStateEvent).toHaveBeenNthCalledWith(1, missedEvents[0]);
    expect(repository.saveRoomStateEvent).toHaveBeenNthCalledWith(2, missedEvents[1]);
    expect(repository.setRoomState).toHaveBeenCalledWith("room-1", snapshot);
  });

  it("throws when missedEvents are not contiguous", () => {
    const repository = makeRepository({
      getRoomState: vi.fn(() => makeRoomState({ revision: 0, keyEpoch: 1 })),
    });
    const service = new ResyncService(repository, { getOnlineRoomMembers: vi.fn() }, vi.fn());
    const response: ResyncResponsePayload = {
      roomId: "room-1",
      currentRevision: 2,
      currentKeyEpoch: 1,
      missedEvents: [makeEvent(2)],
      snapshot: makeRoomState({ revision: 2, keyEpoch: 1 }),
    };

    expect(() => service.handleResyncResponse(response)).toThrow("are not contiguous");
    expect(repository.saveRoomStateEvent).not.toHaveBeenCalled();
    expect(repository.setRoomState).not.toHaveBeenCalled();
  });

  it("throws 'Room not found' when setRoomState fails to apply the snapshot", () => {
    const repository = makeRepository({
      getRoomState: vi.fn(() => makeRoomState({ revision: 0, keyEpoch: 1 })),
      setRoomState: vi.fn(() => undefined),
    });
    const service = new ResyncService(repository, { getOnlineRoomMembers: vi.fn() }, vi.fn());
    const response: ResyncResponsePayload = {
      roomId: "room-1",
      currentRevision: 1,
      currentKeyEpoch: 1,
      missedEvents: [makeEvent(1)],
      snapshot: makeRoomState({ revision: 1, keyEpoch: 1 }),
    };

    expect(() => service.handleResyncResponse(response)).toThrow("Room not found");
  });

  describe("agent_added OwnerProof verification", () => {
    it("throws when an agent_added event has no OwnerProof at all", () => {
      const repository = makeRepository({
        getRoomState: vi.fn(() => makeRoomState({ revision: 0, keyEpoch: 1 })),
      });
      const service = new ResyncService(repository, { getOnlineRoomMembers: vi.fn() }, vi.fn());
      const event = makeEvent(1, {
        eventType: "agent_added",
        actorUserId: "usr_owner",
        data: { agentId: "agent-1" },
      });
      const response: ResyncResponsePayload = {
        roomId: "room-1",
        currentRevision: 1,
        currentKeyEpoch: 1,
        missedEvents: [event],
        snapshot: makeRoomState({ revision: 1, keyEpoch: 1 }),
      };

      expect(() => service.handleResyncResponse(response)).toThrow("has no OwnerProof");
    });

    it("throws when the OwnerProof claims do not match the agent_added event", () => {
      const owner = generateUserKeyPair();
      const proof = createOwnerProof("agent-1", "usr_owner", "room-1", 1, owner.privateKey);
      const repository = makeRepository({
        getRoomState: vi.fn(() => makeRoomState({ revision: 0, keyEpoch: 1 })),
      });
      const resolveOwnerPublicKey = vi.fn(() => owner.publicKey);
      const service = new ResyncService(
        repository,
        { getOnlineRoomMembers: vi.fn() },
        vi.fn(),
        undefined,
        resolveOwnerPublicKey,
      );
      const event = makeEvent(1, {
        eventType: "agent_added",
        // actorUserId does not match proof.ownerId.
        actorUserId: "usr_someone_else",
        keyEpoch: 1,
        data: { agentId: "agent-1", ownerProof: proof },
      });
      const response: ResyncResponsePayload = {
        roomId: "room-1",
        currentRevision: 1,
        currentKeyEpoch: 1,
        missedEvents: [event],
        snapshot: makeRoomState({ revision: 1, keyEpoch: 1 }),
      };

      expect(() => service.handleResyncResponse(response)).toThrow(
        "OwnerProof claims do not match",
      );
    });

    it("throws when the owner's public key cannot be resolved", () => {
      const owner = generateUserKeyPair();
      const proof = createOwnerProof("agent-1", "usr_owner", "room-1", 1, owner.privateKey);
      const repository = makeRepository({
        getRoomState: vi.fn(() => makeRoomState({ revision: 0, keyEpoch: 1 })),
      });
      const service = new ResyncService(
        repository,
        { getOnlineRoomMembers: vi.fn() },
        vi.fn(),
        undefined,
        () => undefined,
      );
      const event = makeEvent(1, {
        eventType: "agent_added",
        actorUserId: "usr_owner",
        keyEpoch: 1,
        data: { agentId: "agent-1", ownerProof: proof },
      });
      const response: ResyncResponsePayload = {
        roomId: "room-1",
        currentRevision: 1,
        currentKeyEpoch: 1,
        missedEvents: [event],
        snapshot: makeRoomState({ revision: 1, keyEpoch: 1 }),
      };

      expect(() => service.handleResyncResponse(response)).toThrow("Invalid or expired OwnerProof");
    });

    it("throws when the proof's key epoch no longer matches the Room's current epoch", () => {
      const owner = generateUserKeyPair();
      // Proof signed for keyEpoch 1, but the event (and response) claim epoch 2.
      const proof = createOwnerProof("agent-1", "usr_owner", "room-1", 1, owner.privateKey);
      const repository = makeRepository({
        getRoomState: vi.fn(() => makeRoomState({ revision: 0, keyEpoch: 1 })),
      });
      const resolveOwnerPublicKey = vi.fn(() => owner.publicKey);
      const service = new ResyncService(
        repository,
        { getOnlineRoomMembers: vi.fn() },
        vi.fn(),
        undefined,
        resolveOwnerPublicKey,
      );
      const event = makeEvent(1, {
        eventType: "agent_added",
        actorUserId: "usr_owner",
        keyEpoch: 1,
        data: { agentId: "agent-1", ownerProof: proof },
      });
      const response: ResyncResponsePayload = {
        roomId: "room-1",
        currentRevision: 1,
        currentKeyEpoch: 2,
        missedEvents: [event],
        snapshot: makeRoomState({ revision: 1, keyEpoch: 2 }),
      };

      expect(() => service.handleResyncResponse(response)).toThrow("Invalid or expired OwnerProof");
    });

    it("accepts a valid OwnerProof and applies the agent_added event", () => {
      const owner = generateUserKeyPair();
      const proof = createOwnerProof("agent-1", "usr_owner", "room-1", 1, owner.privateKey);
      const repository = makeRepository({
        getRoomState: vi.fn(() => makeRoomState({ revision: 0, keyEpoch: 1 })),
      });
      const resolveOwnerPublicKey = vi.fn((ownerId: string) =>
        ownerId === "usr_owner" ? owner.publicKey : undefined,
      );
      const service = new ResyncService(
        repository,
        { getOnlineRoomMembers: vi.fn() },
        vi.fn(),
        undefined,
        resolveOwnerPublicKey,
      );
      const event = makeEvent(1, {
        eventType: "agent_added",
        actorUserId: "usr_owner",
        keyEpoch: 1,
        data: { agentId: "agent-1", ownerProof: proof },
      });
      const response: ResyncResponsePayload = {
        roomId: "room-1",
        currentRevision: 1,
        currentKeyEpoch: 1,
        missedEvents: [event],
        snapshot: makeRoomState({ revision: 1, keyEpoch: 1 }),
      };

      const result = service.handleResyncResponse(response);

      expect(result).toBe(true);
      expect(resolveOwnerPublicKey).toHaveBeenCalledWith("usr_owner");
      expect(repository.saveRoomStateEvent).toHaveBeenCalledWith(event);
    });
  });
});
