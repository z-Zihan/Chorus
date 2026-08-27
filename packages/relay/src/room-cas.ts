import { eq } from "drizzle-orm";
import type { RoomCasResult, RoomCasState } from "@chorus/shared";
import type { DatabaseContext } from "./db/index.js";
import { rooms } from "./db/schema.js";

/**
 * Authoritative per-Room revision/key-epoch compare-and-swap store, persisted
 * in the rooms table. In-memory state previously reset to {1,1} on restart,
 * permanently rejecting every client whose cached revision had moved past it.
 *
 * Per CROSS_DEVICE_DESIGN room-state CAS contract: a proposal is accepted only
 * when the current counters match the expectation exactly and newRevision is
 * current+1; keyEpoch may stay flat (plain membership/revision bump) or advance
 * by exactly one (rekey). The relay arbitrates ordering only - it never sees
 * room keys.
 */
export class RoomCasStore {
  constructor(private readonly database: DatabaseContext) {}

  get(roomId: string): RoomCasState {
    const row = this.database.db
      .select({ revision: rooms.revision, keyEpoch: rooms.keyEpoch })
      .from(rooms)
      .where(eq(rooms.id, roomId))
      .get();
    const current = row ?? { revision: 1, keyEpoch: 1 };
    return { ...current };
  }

  cas(
    roomId: string,
    expectedRevision: number,
    expectedKeyEpoch: number,
    newRevision: number,
    newKeyEpoch: number,
  ): RoomCasResult {
    const current = this.get(roomId);
    const accepted = this.database.sqlite.transaction(() => {
      const row = this.database.db
        .select({ revision: rooms.revision, keyEpoch: rooms.keyEpoch })
        .from(rooms)
        .where(eq(rooms.id, roomId))
        .get();
      const latest = row ?? { revision: 1, keyEpoch: 1 };
      if (
        latest.revision !== expectedRevision ||
        latest.keyEpoch !== expectedKeyEpoch ||
        newRevision !== latest.revision + 1 ||
        (newKeyEpoch !== latest.keyEpoch && newKeyEpoch !== latest.keyEpoch + 1) ||
        newKeyEpoch < 1
      ) {
        return false;
      }
      if (row) {
        this.database.db
          .update(rooms)
          .set({ revision: newRevision, keyEpoch: newKeyEpoch })
          .where(eq(rooms.id, roomId))
          .run();
      } else {
        // Unknown room: seed the authoritative counters instead of updating a
        // nonexistent row. FK to rooms would fail for a truly unknown id only
        // at relay level — the WS handler gates proposals on room membership.
        this.database.db
          .insert(rooms)
          .values({
            id: roomId,
            name: roomId,
            createdBy: "",
            createdAt: Date.now(),
            revision: newRevision,
            keyEpoch: newKeyEpoch,
          })
          .onConflictDoNothing()
          .run();
      }
      return true;
    })();

    if (!accepted) return { accepted: false, ...current };
    return { accepted: true, revision: newRevision, keyEpoch: newKeyEpoch };
  }
}
