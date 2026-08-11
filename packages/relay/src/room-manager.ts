import type { RoomInfo, RoomMember } from "@chorus/shared";
import { and, count, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DatabaseContext } from "./db/index.js";
import { hubs, roomMembers, rooms } from "./db/schema.js";

export type RoomRecord = typeof rooms.$inferSelect;

export const DEFAULT_MAX_ROOMS_PER_HUB = 50;
export const DEFAULT_MAX_MEMBERS_PER_ROOM = 100;

export class RoomManager {
  constructor(
    private readonly database: DatabaseContext,
    private readonly maxRoomsPerHub = DEFAULT_MAX_ROOMS_PER_HUB,
    private readonly maxMembersPerRoom = DEFAULT_MAX_MEMBERS_PER_ROOM,
  ) {}

  createRoom(name: string, createdByHubId: string): RoomRecord {
    if (!this.database.db.select({ id: hubs.hubId }).from(hubs).where(eq(hubs.hubId, createdByHubId)).get()) {
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
      this.database.db.insert(roomMembers).values({
        roomId: room.id,
        hubId: createdByHubId,
        joinedAt: room.createdAt,
      }).run();
    })();
    return room;
  }

  joinRoom(roomId: string, hubId: string): void {
    if (!this.getRoom(roomId)) throw new Error("Room not found");
    if (!this.database.db.select({ id: hubs.hubId }).from(hubs).where(eq(hubs.hubId, hubId)).get()) {
      throw new Error("Hub not found");
    }
    if (this.isMember(roomId, hubId)) return;
    this.assertHubRoomCapacity(hubId);
    if (this.memberCount(roomId) >= this.maxMembersPerRoom) {
      throw new Error(`Room member limit of ${this.maxMembersPerRoom} reached`);
    }
    this.database.db.insert(roomMembers).values({ roomId, hubId, joinedAt: Date.now() })
      .onConflictDoNothing().run();
  }

  leaveRoom(roomId: string, hubId: string): void {
    this.database.db.delete(roomMembers).where(
      and(eq(roomMembers.roomId, roomId), eq(roomMembers.hubId, hubId)),
    ).run();
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

  inviteToRoom(roomId: string, hubId: string): void {
    this.joinRoom(roomId, hubId);
  }

  getRoomInfo(roomId: string): RoomInfo | null {
    const room = this.getRoom(roomId);
    return room ? { ...room, members: this.getMembers(roomId) } : null;
  }

  isMember(roomId: string, hubId: string): boolean {
    return Boolean(this.database.db
      .select({ roomId: roomMembers.roomId })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.hubId, hubId)))
      .get());
  }

  private memberCount(roomId: string): number {
    return this.database.db
      .select({ value: count() })
      .from(roomMembers)
      .where(eq(roomMembers.roomId, roomId))
      .get()?.value ?? 0;
  }

  private assertHubRoomCapacity(hubId: string): void {
    const roomCount = this.database.db
      .select({ value: count() })
      .from(roomMembers)
      .where(eq(roomMembers.hubId, hubId))
      .get()?.value ?? 0;
    if (roomCount >= this.maxRoomsPerHub) {
      throw new Error(`Hub room limit of ${this.maxRoomsPerHub} reached`);
    }
  }
}
