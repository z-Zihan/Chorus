import type { RoomInfo, RoomInvitation, RoomInvitationStatus, RoomMember } from "@chorus/shared";
import { and, count, eq, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DatabaseContext } from "./db/index.js";
import { hubs, roomInvitations, roomMembers, rooms } from "./db/schema.js";

export type RoomRecord = typeof rooms.$inferSelect;

export const DEFAULT_MAX_ROOMS_PER_HUB = 50;
export const DEFAULT_MAX_MEMBERS_PER_ROOM = 100;
export const DEFAULT_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export class RoomManager {
  constructor(
    private readonly database: DatabaseContext,
    private readonly maxRoomsPerHub = DEFAULT_MAX_ROOMS_PER_HUB,
    private readonly maxMembersPerRoom = DEFAULT_MAX_MEMBERS_PER_ROOM,
  ) {}

  createRoom(name: string, createdByHubId: string): RoomRecord {
    if (
      !this.database.db
        .select({ id: hubs.hubId })
        .from(hubs)
        .where(eq(hubs.hubId, createdByHubId))
        .get()
    ) {
      throw new Error("Creator hub not found");
    }
    this.assertHubRoomCapacity(createdByHubId);
    const room: RoomRecord = {
      id: nanoid(),
      name,
      createdBy: createdByHubId,
      createdAt: Date.now(),
    };
    this.database.sqlite.transaction(() => {
      this.database.db.insert(rooms).values(room).run();
      this.database.db
        .insert(roomMembers)
        .values({
          roomId: room.id,
          hubId: createdByHubId,
          joinedAt: room.createdAt,
        })
        .run();
    })();
    return room;
  }

  joinRoom(roomId: string, hubId: string): void {
    if (!this.getRoom(roomId)) throw new Error("Room not found");
    if (
      !this.database.db.select({ id: hubs.hubId }).from(hubs).where(eq(hubs.hubId, hubId)).get()
    ) {
      throw new Error("Hub not found");
    }
    if (this.isMember(roomId, hubId)) return;
    this.assertHubRoomCapacity(hubId);
    if (this.memberCount(roomId) >= this.maxMembersPerRoom) {
      throw new Error(`Room member limit of ${this.maxMembersPerRoom} reached`);
    }
    this.database.db
      .insert(roomMembers)
      .values({ roomId, hubId, joinedAt: Date.now() })
      .onConflictDoNothing()
      .run();
  }

  leaveRoom(roomId: string, hubId: string): void {
    this.database.db
      .delete(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.hubId, hubId)))
      .run();
  }

  getRoom(roomId: string): RoomRecord | null {
    return this.database.db.select().from(rooms).where(eq(rooms.id, roomId)).get() ?? null;
  }

  getMembers(roomId: string): RoomMember[] {
    return this.database.db
      .select({
        hubId: hubs.hubId,
        publicKey: hubs.publicKey,
        displayName: hubs.displayName,
        online: hubs.online,
      })
      .from(roomMembers)
      .innerJoin(hubs, eq(roomMembers.hubId, hubs.hubId))
      .where(eq(roomMembers.roomId, roomId))
      .all();
  }

  inviteToRoom(
    roomId: string,
    inviteeHubId: string,
    invitedByHubId: string,
    ttlMs = DEFAULT_INVITATION_TTL_MS,
  ): RoomInvitation {
    const room = this.getRoom(roomId);
    if (!room) throw new Error("Room not found");
    if (room.createdBy !== invitedByHubId) throw new Error("Room administrator required");
    if (inviteeHubId === invitedByHubId) throw new Error("Cannot invite the current Hub");
    if (
      !this.database.db
        .select({ id: hubs.hubId })
        .from(hubs)
        .where(eq(hubs.hubId, inviteeHubId))
        .get()
    ) {
      throw new Error("Invited Hub not found");
    }
    if (this.isMember(roomId, inviteeHubId)) throw new Error("Hub is already a Room member");

    const now = Date.now();
    this.database.db
      .insert(roomInvitations)
      .values({
        roomId,
        inviteeHubId,
        invitedByHubId,
        status: "pending",
        createdAt: now,
        expiresAt: now + ttlMs,
        respondedAt: null,
      })
      .onConflictDoUpdate({
        target: [roomInvitations.roomId, roomInvitations.inviteeHubId],
        set: {
          invitedByHubId,
          status: "pending",
          createdAt: now,
          expiresAt: now + ttlMs,
          respondedAt: null,
        },
      })
      .run();
    return this.requireInvitation(roomId, inviteeHubId);
  }

  listInvitations(inviteeHubId: string): RoomInvitation[] {
    this.expireInvitations();
    return this.database.db
      .select()
      .from(roomInvitations)
      .where(eq(roomInvitations.inviteeHubId, inviteeHubId))
      .all()
      .map((invitation) => this.toInvitation(invitation))
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  respondToInvitation(
    roomId: string,
    inviteeHubId: string,
    response: Extract<RoomInvitationStatus, "accepted" | "declined">,
  ): RoomInvitation {
    this.expireInvitations();
    const invitation = this.database.db
      .select()
      .from(roomInvitations)
      .where(
        and(eq(roomInvitations.roomId, roomId), eq(roomInvitations.inviteeHubId, inviteeHubId)),
      )
      .get();
    if (!invitation) {
      throw new Error("Pending Room invitation not found");
    }
    if (invitation.status === response) {
      if (response === "accepted") this.joinRoom(roomId, inviteeHubId);
      return this.toInvitation(invitation);
    }
    if (invitation.status !== "pending") throw new Error("Pending Room invitation not found");
    if (response === "accepted") this.joinRoom(roomId, inviteeHubId);
    this.database.db
      .update(roomInvitations)
      .set({
        status: response,
        respondedAt: Date.now(),
      })
      .where(
        and(eq(roomInvitations.roomId, roomId), eq(roomInvitations.inviteeHubId, inviteeHubId)),
      )
      .run();
    return this.requireInvitation(roomId, inviteeHubId);
  }

  revokeInvitation(roomId: string, inviteeHubId: string, requestedByHubId: string): RoomInvitation {
    const room = this.getRoom(roomId);
    if (!room) throw new Error("Room not found");
    if (room.createdBy !== requestedByHubId) throw new Error("Room administrator required");
    const invitation = this.requireInvitation(roomId, inviteeHubId);
    if (invitation.status !== "pending") throw new Error("Only pending invitations can be revoked");
    this.database.db
      .update(roomInvitations)
      .set({
        status: "revoked",
        respondedAt: Date.now(),
      })
      .where(
        and(eq(roomInvitations.roomId, roomId), eq(roomInvitations.inviteeHubId, inviteeHubId)),
      )
      .run();
    return this.requireInvitation(roomId, inviteeHubId);
  }

  isCreator(roomId: string, hubId: string): boolean {
    return this.getRoom(roomId)?.createdBy === hubId;
  }

  getRoomInfo(roomId: string): RoomInfo | null {
    const room = this.getRoom(roomId);
    return room ? { ...room, members: this.getMembers(roomId) } : null;
  }

  isMember(roomId: string, hubId: string): boolean {
    return Boolean(
      this.database.db
        .select({ roomId: roomMembers.roomId })
        .from(roomMembers)
        .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.hubId, hubId)))
        .get(),
    );
  }

  private memberCount(roomId: string): number {
    return (
      this.database.db
        .select({ value: count() })
        .from(roomMembers)
        .where(eq(roomMembers.roomId, roomId))
        .get()?.value ?? 0
    );
  }

  private expireInvitations(): void {
    this.database.db
      .update(roomInvitations)
      .set({
        status: "expired",
        respondedAt: Date.now(),
      })
      .where(and(eq(roomInvitations.status, "pending"), lt(roomInvitations.expiresAt, Date.now())))
      .run();
  }

  private requireInvitation(roomId: string, inviteeHubId: string): RoomInvitation {
    const invitation = this.database.db
      .select()
      .from(roomInvitations)
      .where(
        and(eq(roomInvitations.roomId, roomId), eq(roomInvitations.inviteeHubId, inviteeHubId)),
      )
      .get();
    if (!invitation) throw new Error("Room invitation not found");
    return this.toInvitation(invitation);
  }

  private toInvitation(invitation: typeof roomInvitations.$inferSelect): RoomInvitation {
    const room = this.getRoom(invitation.roomId);
    if (!room) throw new Error("Invitation Room not found");
    const inviter = this.database.db
      .select()
      .from(hubs)
      .where(eq(hubs.hubId, invitation.invitedByHubId))
      .get();
    return {
      roomId: invitation.roomId,
      roomName: room.name,
      inviteeHubId: invitation.inviteeHubId,
      invitedByHubId: invitation.invitedByHubId,
      invitedByName: inviter?.displayName,
      status: invitation.status,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      respondedAt: invitation.respondedAt ?? undefined,
    };
  }

  private assertHubRoomCapacity(hubId: string): void {
    const roomCount =
      this.database.db
        .select({ value: count() })
        .from(roomMembers)
        .where(eq(roomMembers.hubId, hubId))
        .get()?.value ?? 0;
    if (roomCount >= this.maxRoomsPerHub) {
      throw new Error(`Hub room limit of ${this.maxRoomsPerHub} reached`);
    }
  }
}
