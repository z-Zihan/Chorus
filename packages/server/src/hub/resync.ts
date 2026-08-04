import { randomUUID } from "node:crypto";
import type {
  HubPayload,
  PersistedRoomState,
  ResyncRequestPayload,
  ResyncResponsePayload,
  RoomMember,
  RoomStateEvent,
} from "@agentlink/shared";
import type { Repository } from "../db/repository.js";
import { isOwnerProof, verifyOwnerProof } from "./owner-proof.js";

export const MAX_INCREMENTAL_RESYNC_EVENTS = 100;

type ResyncMessage = Omit<
  HubPayload,
  "protocolVersion" | "fromUserId" | "fromUserName" | "agentId"
>;

interface ResyncRelay {
  getOnlineRoomMembers(roomId: string): RoomMember[];
}

type ResyncRepository = Pick<
  Repository,
  | "getRoomState"
  | "getRoomStateEvents"
  | "listRoomIds"
  | "saveRoomStateEvent"
  | "setRoomState"
>;

type ResyncSender = (toHubId: string, payload: ResyncMessage, roomId: string) => Promise<unknown>;
type OwnerPublicKeyResolver = (ownerId: string) => string | undefined;

/** Repairs Room state after Relay TTL expiry has made message replay incomplete. */
export class ResyncService {
  constructor(
    private readonly repository: ResyncRepository,
    private readonly relay: ResyncRelay,
    private readonly send: ResyncSender,
    private readonly localHubId?: string,
    private readonly resolveOwnerPublicKey: OwnerPublicKeyResolver = () => undefined,
  ) {}

  async requestResync(roomId: string): Promise<void> {
    const state = this.requireRoomState(roomId);
    const request: ResyncRequestPayload = {
      roomId,
      lastKnownRevision: state.revision,
      lastKnownKeyEpoch: state.keyEpoch,
    };
    const recipients = this.relay
      .getOnlineRoomMembers(roomId)
      .filter(({ hubId }) => hubId !== this.localHubId);
    await Promise.all(recipients.map(({ hubId }) => this.send(hubId, {
      messageType: "resync_request",
      messageId: randomUUID(),
      conversationId: roomId,
      resyncRequest: request,
    }, roomId)));
  }

  async requestAllRooms(): Promise<void> {
    await Promise.all(this.repository.listRoomIds().map((roomId) => this.requestResync(roomId)));
  }

  handleResyncRequest(request: ResyncRequestPayload): ResyncResponsePayload {
    assertResyncRequest(request);
    const snapshot = this.requireRoomState(request.roomId);
    const revisionGap = snapshot.revision - request.lastKnownRevision;
    let missedEvents: RoomStateEvent[] = [];

    if (revisionGap > 0 && revisionGap <= MAX_INCREMENTAL_RESYNC_EVENTS) {
      const candidates = this.repository.getRoomStateEvents(
        request.roomId,
        request.lastKnownRevision,
        MAX_INCREMENTAL_RESYNC_EVENTS + 1,
      ).filter((event) => event.revision <= snapshot.revision);
      if (hasCompleteRevisionRange(candidates, request.lastKnownRevision, snapshot.revision)) {
        missedEvents = candidates;
      }
    }

    return {
      roomId: request.roomId,
      currentRevision: snapshot.revision,
      currentKeyEpoch: snapshot.keyEpoch,
      missedEvents,
      snapshot,
    };
  }

  handleResyncResponse(response: ResyncResponsePayload): boolean {
    assertResyncResponse(response);
    const current = this.requireRoomState(response.roomId);
    if (response.currentRevision <= current.revision) return false;

    if (response.missedEvents.length > 0) {
      if (!hasCompleteRevisionRange(
        response.missedEvents,
        current.revision,
        response.currentRevision,
      )) {
        throw new Error(`Resync events for Room ${response.roomId} are not contiguous`);
      }
      for (const event of response.missedEvents) this.verifyInboundEvent(event, response);
      for (const event of response.missedEvents) this.repository.saveRoomStateEvent(event);
    }

    const applied = this.repository.setRoomState(response.roomId, response.snapshot);
    if (!applied) throw new Error(`Room not found: ${response.roomId}`);
    return true;
  }

  private requireRoomState(roomId: string): PersistedRoomState {
    const state = this.repository.getRoomState(roomId);
    if (!state) throw new Error(`Room not found: ${roomId}`);
    return state;
  }

  private verifyInboundEvent(event: RoomStateEvent, response: ResyncResponsePayload): void {
    if (event.roomId !== response.roomId) {
      throw new Error(`Resync event ${event.eventId} belongs to another Room`);
    }
    if (event.eventType !== "agent_added") return;
    const proof = event.data.ownerProof;
    if (!isOwnerProof(proof)) throw new Error(`agent_added event ${event.eventId} has no OwnerProof`);
    const agentId = event.data.agentId;
    if (
      proof.agentId !== agentId
      || proof.ownerId !== event.actorUserId
      || proof.roomId !== response.roomId
      || proof.keyEpoch !== event.keyEpoch
    ) {
      throw new Error(`OwnerProof claims do not match agent_added event ${event.eventId}`);
    }
    const publicKey = this.resolveOwnerPublicKey(proof.ownerId);
    if (!publicKey || !verifyOwnerProof(proof, publicKey, response.currentKeyEpoch)) {
      throw new Error(`Invalid or expired OwnerProof for Agent ${proof.agentId}`);
    }
  }
}

function hasCompleteRevisionRange(
  events: RoomStateEvent[],
  previousRevision: number,
  currentRevision: number,
): boolean {
  if (events.length !== currentRevision - previousRevision) return false;
  return events.every((event, index) => event.revision === previousRevision + index + 1);
}

function assertResyncRequest(request: ResyncRequestPayload): void {
  if (
    !request.roomId
    || !Number.isSafeInteger(request.lastKnownRevision)
    || request.lastKnownRevision < 0
    || !Number.isSafeInteger(request.lastKnownKeyEpoch)
    || request.lastKnownKeyEpoch < 1
  ) {
    throw new Error("Invalid resync request");
  }
}

function assertResyncResponse(response: ResyncResponsePayload): void {
  if (
    !response.roomId
    || !Number.isSafeInteger(response.currentRevision)
    || response.currentRevision < 0
    || !Number.isSafeInteger(response.currentKeyEpoch)
    || response.currentKeyEpoch < 1
    || response.snapshot.revision !== response.currentRevision
    || response.snapshot.keyEpoch !== response.currentKeyEpoch
    || (response.snapshot.managementState !== "managed"
      && response.snapshot.managementState !== "unmanaged")
  ) {
    throw new Error("Invalid resync response");
  }
}
