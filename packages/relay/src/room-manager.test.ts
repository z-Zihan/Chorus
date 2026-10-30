import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, type DatabaseContext } from "./db/index.js";
import { roomInvitations, roomMembers } from "./db/schema.js";
import { HubRegistry } from "./hub-registry.js";
import { RoomManager } from "./room-manager.js";

describe("RoomManager", () => {
  let directory: string;
  let database: DatabaseContext;
  let registry: HubRegistry;
  let manager: RoomManager;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "chorus-relay-rooms-"));
    database = createDatabase(join(directory, "relay.db"));
    registry = new HubRegistry(database);
    manager = new RoomManager(database, 2, 2);
    registry.register("hub-a", "key-a", "Hub A");
    registry.register("hub-b", "key-b", "Hub B");
    registry.register("hub-c", "key-c", "Hub C");
  });

  afterEach(() => {
    vi.useRealTimers();
    database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function memberRows(roomId: string, hubId: string) {
    return database.db
      .select()
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.hubId, hubId)))
      .all();
  }

  describe("createRoom", () => {
    it("rejects an unknown creator hub", () => {
      expect(() => manager.createRoom("Room", "hub-missing")).toThrow("Creator hub not found");
    });

    it("creates a room at revision 1 with the creator as member", () => {
      const room = manager.createRoom("Room", "hub-a");

      expect(room).toMatchObject({ name: "Room", createdBy: "hub-a", revision: 1, keyEpoch: 1 });
      expect(room.id).toEqual(expect.any(String));
      expect(manager.getRoom(room.id)).toEqual(room);
      expect(manager.isMember(room.id, "hub-a")).toBe(true);
      expect(manager.isCreator(room.id, "hub-a")).toBe(true);
    });

    it("enforces the per-hub room limit", () => {
      manager.createRoom("One", "hub-a");
      manager.createRoom("Two", "hub-a");

      expect(() => manager.createRoom("Three", "hub-a")).toThrow("Hub room limit of 2 reached");
    });
  });

  describe("joinRoom", () => {
    it("rejects a missing room", () => {
      expect(() => manager.joinRoom("room-missing", "hub-b")).toThrow("Room not found");
    });

    it("rejects a missing hub", () => {
      const room = manager.createRoom("Room", "hub-a");
      expect(() => manager.joinRoom(room.id, "hub-missing")).toThrow("Hub not found");
    });

    it("is idempotent for an existing member", () => {
      const room = manager.createRoom("Room", "hub-a");
      manager.joinRoom(room.id, "hub-b");
      manager.joinRoom(room.id, "hub-b");

      expect(manager.isMember(room.id, "hub-b")).toBe(true);
      expect(memberRows(room.id, "hub-b")).toHaveLength(1);
    });

    it("enforces the per-room member limit", () => {
      const room = manager.createRoom("Room", "hub-a");
      manager.joinRoom(room.id, "hub-b");

      expect(() => manager.joinRoom(room.id, "hub-c")).toThrow("Room member limit of 2 reached");
      expect(manager.isMember(room.id, "hub-c")).toBe(false);
    });

    it("enforces the per-hub room limit for the joining hub", () => {
      manager.createRoom("One", "hub-b");
      manager.createRoom("Two", "hub-b");
      const room = manager.createRoom("Room", "hub-a");

      expect(() => manager.joinRoom(room.id, "hub-b")).toThrow("Hub room limit of 2 reached");
    });
  });

  describe("leaveRoom", () => {
    it("removes membership", () => {
      const room = manager.createRoom("Room", "hub-a");
      manager.joinRoom(room.id, "hub-b");
      manager.leaveRoom(room.id, "hub-b");

      expect(manager.isMember(room.id, "hub-b")).toBe(false);
      expect(manager.isMember(room.id, "hub-a")).toBe(true);
    });

    it("is a silent no-op for non-members", () => {
      const room = manager.createRoom("Room", "hub-a");

      expect(() => manager.leaveRoom(room.id, "hub-c")).not.toThrow();
      expect(() => manager.leaveRoom("room-missing", "hub-c")).not.toThrow();
      expect(manager.getMembers(room.id).map((member) => member.hubId)).toEqual(["hub-a"]);
    });
  });

  describe("inviteToRoom", () => {
    it("rejects a missing room", () => {
      expect(() => manager.inviteToRoom("room-missing", "hub-b", "hub-a")).toThrow(
        "Room not found",
      );
    });

    it("requires the room creator", () => {
      const room = manager.createRoom("Room", "hub-a");
      manager.joinRoom(room.id, "hub-b");

      expect(() => manager.inviteToRoom(room.id, "hub-c", "hub-b")).toThrow(
        "Room administrator required",
      );
    });

    it("rejects self-invites", () => {
      const room = manager.createRoom("Room", "hub-a");
      expect(() => manager.inviteToRoom(room.id, "hub-a", "hub-a")).toThrow(
        "Cannot invite the current Hub",
      );
    });

    it("rejects unregistered invitees", () => {
      const room = manager.createRoom("Room", "hub-a");
      expect(() => manager.inviteToRoom(room.id, "hub-missing", "hub-a")).toThrow(
        "Invited Hub not found",
      );
    });

    it("rejects existing members", () => {
      const room = manager.createRoom("Room", "hub-a");
      manager.joinRoom(room.id, "hub-b");

      expect(() => manager.inviteToRoom(room.id, "hub-b", "hub-a")).toThrow(
        "Hub is already a Room member",
      );
    });

    it("creates a pending invitation with inviter details", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const room = manager.createRoom("Room", "hub-a");
      const invitation = manager.inviteToRoom(room.id, "hub-b", "hub-a", 5_000);

      expect(invitation).toEqual({
        roomId: room.id,
        roomName: "Room",
        inviteeHubId: "hub-b",
        invitedByHubId: "hub-a",
        invitedByName: "Hub A",
        status: "pending",
        createdAt: 10_000,
        expiresAt: 15_000,
        respondedAt: undefined,
      });
    });

    it("upserts a declined invitation back to pending with a new expiry", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const room = manager.createRoom("Room", "hub-a");
      manager.inviteToRoom(room.id, "hub-b", "hub-a", 5_000);
      vi.setSystemTime(11_000);
      expect(manager.respondToInvitation(room.id, "hub-b", "declined").status).toBe("declined");

      vi.setSystemTime(20_000);
      const reinvited = manager.inviteToRoom(room.id, "hub-b", "hub-a", 5_000);

      expect(reinvited).toMatchObject({
        status: "pending",
        createdAt: 20_000,
        expiresAt: 25_000,
        respondedAt: undefined,
      });
      expect(
        database.db
          .select()
          .from(roomInvitations)
          .where(eq(roomInvitations.inviteeHubId, "hub-b"))
          .all(),
      ).toHaveLength(1);
    });
  });

  describe("listInvitations", () => {
    it("returns only the caller's invitations, newest first", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(1_000);
      const first = manager.createRoom("First", "hub-a");
      const second = manager.createRoom("Second", "hub-a");
      manager.inviteToRoom(first.id, "hub-b", "hub-a");
      vi.setSystemTime(2_000);
      manager.inviteToRoom(second.id, "hub-b", "hub-a");
      manager.inviteToRoom(first.id, "hub-c", "hub-a");

      const invitations = manager.listInvitations("hub-b");

      expect(invitations.map((invitation) => invitation.roomName)).toEqual(["Second", "First"]);
      expect(invitations.every((invitation) => invitation.inviteeHubId === "hub-b")).toBe(true);
      expect(manager.listInvitations("hub-a")).toEqual([]);
    });

    it("flips expired pending invitations to expired", () => {
      const room = manager.createRoom("Room", "hub-a");
      manager.inviteToRoom(room.id, "hub-b", "hub-a", -1);

      const [invitation] = manager.listInvitations("hub-b");

      expect(invitation?.status).toBe("expired");
      expect(invitation?.respondedAt).toEqual(expect.any(Number));
    });
  });

  describe("respondToInvitation", () => {
    it("rejects a missing invitation", () => {
      const room = manager.createRoom("Room", "hub-a");
      expect(() => manager.respondToInvitation(room.id, "hub-b", "accepted")).toThrow(
        "Pending Room invitation not found",
      );
    });

    it("joins the room on accept", () => {
      const room = manager.createRoom("Room", "hub-a");
      manager.inviteToRoom(room.id, "hub-b", "hub-a");

      const invitation = manager.respondToInvitation(room.id, "hub-b", "accepted");

      expect(invitation.status).toBe("accepted");
      expect(invitation.respondedAt).toEqual(expect.any(Number));
      expect(manager.isMember(room.id, "hub-b")).toBe(true);
    });

    it("does not join the room on decline", () => {
      const room = manager.createRoom("Room", "hub-a");
      manager.inviteToRoom(room.id, "hub-b", "hub-a");

      expect(manager.respondToInvitation(room.id, "hub-b", "declined").status).toBe("declined");
      expect(manager.isMember(room.id, "hub-b")).toBe(false);
    });

    it("treats repeating the same final response as idempotent", () => {
      const room = manager.createRoom("Room", "hub-a");
      manager.inviteToRoom(room.id, "hub-b", "hub-a");
      manager.inviteToRoom(room.id, "hub-c", "hub-a");
      const accepted = manager.respondToInvitation(room.id, "hub-b", "accepted");
      const declined = manager.respondToInvitation(room.id, "hub-c", "declined");

      expect(manager.respondToInvitation(room.id, "hub-b", "accepted")).toEqual(accepted);
      expect(manager.respondToInvitation(room.id, "hub-c", "declined")).toEqual(declined);
      expect(memberRows(room.id, "hub-b")).toHaveLength(1);
      expect(manager.isMember(room.id, "hub-c")).toBe(false);
    });

    it("re-joins on a repeated accept after the invitee left", () => {
      const room = manager.createRoom("Room", "hub-a");
      manager.inviteToRoom(room.id, "hub-b", "hub-a");
      manager.respondToInvitation(room.id, "hub-b", "accepted");
      manager.leaveRoom(room.id, "hub-b");

      // Same-status response re-runs joinRoom for "accepted".
      manager.respondToInvitation(room.id, "hub-b", "accepted");
      expect(manager.isMember(room.id, "hub-b")).toBe(true);
    });

    it("rejects a different response once the invitation is final", () => {
      const room = manager.createRoom("Room", "hub-a");
      manager.inviteToRoom(room.id, "hub-b", "hub-a");
      manager.respondToInvitation(room.id, "hub-b", "declined");

      expect(() => manager.respondToInvitation(room.id, "hub-b", "accepted")).toThrow(
        "Pending Room invitation not found",
      );
      expect(manager.isMember(room.id, "hub-b")).toBe(false);
    });

    it("rejects an expired invitation", () => {
      const room = manager.createRoom("Room", "hub-a");
      manager.inviteToRoom(room.id, "hub-b", "hub-a", -1);

      expect(() => manager.respondToInvitation(room.id, "hub-b", "accepted")).toThrow(
        "Pending Room invitation not found",
      );
      expect(manager.isMember(room.id, "hub-b")).toBe(false);
    });
  });

  describe("revokeInvitation", () => {
    it("rejects a missing room", () => {
      expect(() => manager.revokeInvitation("room-missing", "hub-b", "hub-a")).toThrow(
        "Room not found",
      );
    });

    it("requires the room creator", () => {
      const room = manager.createRoom("Room", "hub-a");
      manager.inviteToRoom(room.id, "hub-b", "hub-a");

      expect(() => manager.revokeInvitation(room.id, "hub-b", "hub-b")).toThrow(
        "Room administrator required",
      );
    });

    it("rejects a missing invitation", () => {
      const room = manager.createRoom("Room", "hub-a");
      expect(() => manager.revokeInvitation(room.id, "hub-b", "hub-a")).toThrow(
        "Room invitation not found",
      );
    });

    it("revokes a pending invitation", () => {
      const room = manager.createRoom("Room", "hub-a");
      manager.inviteToRoom(room.id, "hub-b", "hub-a");

      const revoked = manager.revokeInvitation(room.id, "hub-b", "hub-a");

      expect(revoked.status).toBe("revoked");
      expect(revoked.respondedAt).toEqual(expect.any(Number));
      expect(() => manager.respondToInvitation(room.id, "hub-b", "accepted")).toThrow(
        "Pending Room invitation not found",
      );
    });

    it("rejects already-responded invitations", () => {
      const room = manager.createRoom("Room", "hub-a");
      manager.inviteToRoom(room.id, "hub-b", "hub-a");
      manager.respondToInvitation(room.id, "hub-b", "declined");

      expect(() => manager.revokeInvitation(room.id, "hub-b", "hub-a")).toThrow(
        "Only pending invitations can be revoked",
      );
    });
  });

  describe("room lookups", () => {
    it("reports creator status", () => {
      const room = manager.createRoom("Room", "hub-a");
      manager.joinRoom(room.id, "hub-b");

      expect(manager.isCreator(room.id, "hub-a")).toBe(true);
      expect(manager.isCreator(room.id, "hub-b")).toBe(false);
      expect(manager.isCreator("room-missing", "hub-a")).toBe(false);
    });

    it("returns room info with members", () => {
      const room = manager.createRoom("Room", "hub-a");
      manager.joinRoom(room.id, "hub-b");

      const info = manager.getRoomInfo(room.id);

      expect(info).toMatchObject({ ...room });
      expect(info?.members).toHaveLength(2);
      expect(info?.members).toEqual(
        expect.arrayContaining([
          { hubId: "hub-a", publicKey: "key-a", displayName: "Hub A", online: false },
          { hubId: "hub-b", publicKey: "key-b", displayName: "Hub B", online: false },
        ]),
      );
    });

    it("returns null for unknown rooms", () => {
      expect(manager.getRoom("room-missing")).toBeNull();
      expect(manager.getRoomInfo("room-missing")).toBeNull();
      expect(manager.getMembers("room-missing")).toEqual([]);
    });
  });
});
