import type { RoomCasResult, RoomCasState } from "@chorus/shared";

const INITIAL_ROOM_CAS_STATE: RoomCasState = { revision: 1, keyEpoch: 1 };

/** Authoritative in-process Room revision/key-epoch compare-and-swap store. */
export class RoomCasStore {
  private readonly states = new Map<string, RoomCasState>();

  get(roomId: string): RoomCasState {
    const current = this.states.get(roomId) ?? INITIAL_ROOM_CAS_STATE;
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
    const accepted = current.revision === expectedRevision
      && current.keyEpoch === expectedKeyEpoch
      && newRevision === expectedRevision + 1
      && newKeyEpoch === expectedKeyEpoch + 1;

    if (!accepted) return { accepted: false, ...current };

    const next = { revision: newRevision, keyEpoch: newKeyEpoch };
    this.states.set(roomId, next);
    return { accepted: true, ...next };
  }
}
