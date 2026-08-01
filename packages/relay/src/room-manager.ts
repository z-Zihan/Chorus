import type { RoomInfo, RoomMember } from "@agentlink/shared";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DatabaseContext } from "./db/index.js";
import { hubs, roomMembers, rooms } from "./db/schema.js";

export type RoomRecord = typeof rooms.$inferSelect;

export class RoomManager {
  constructor(private readonly database: DatabaseContext) {}

  createRoom(name: string, createdByHubId: string): RoomRecord {
    if (!this.database.db.select({ id: hubs.hubId }).from(hubs).where(eq(hubs.hubId, createdByHubId)).get()) {
      throw new Error("Creator hub not found");
    }
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
}
