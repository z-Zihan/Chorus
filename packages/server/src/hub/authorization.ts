import type { HubPayload } from "@chorus/shared";
import type { Repository } from "../db/repository.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { TrustStore } from "./trust-store.js";

export type AuthorizationResult = { allowed: true } | { allowed: false; reason: string };

export class AuthorizationService {
  constructor(
    private readonly trustStore: TrustStore,
    private readonly repository: Repository,
    private readonly registry?: AgentRegistry,
  ) {}

  /** Check if an inbound payload is authorized to perform its action. */
  authorize(fromHubId: string, payload: HubPayload): AuthorizationResult {
    const hub = this.trustStore.get(fromHubId);
    if (!hub || hub.trustLevel === "blocked") {
      return { allowed: false, reason: "Hub is blocked or unknown" };
    }

    if (hub.trustLevel === "pending")
      return { allowed: false, reason: "Hub pairing is incomplete" };

    if (hub.userId && payload.fromUserId !== hub.userId) {
      return { allowed: false, reason: "Sender User identity does not match the trusted Hub" };
    }

    if (payload.messageType === "resync_request" || payload.messageType === "resync_response") {
      // Resync exposes (and can rewrite) Room state, so it needs the same Room
      // membership gate as a2a_call/chat — trust alone must not be enough.
      // Only read the Room id from the field the router will actually act on,
      // so a member of Room A cannot smuggle a resync for Room B.
      const resyncRoomId =
        payload.messageType === "resync_request"
          ? payload.resyncRequest?.roomId
          : payload.resyncResponse?.roomId;
      if (typeof resyncRoomId !== "string" || resyncRoomId.length === 0) {
        return { allowed: false, reason: "Resync message has no Room id" };
      }
      const room = this.repository
        .listConversations({ type: "cross_hub" })
        .find(
          (conversation) =>
            conversation.id === resyncRoomId || conversation.relayRoomId === resyncRoomId,
        );
      if (!room?.relayRoomId || !this.registry?.isHubInRoom(room.relayRoomId, fromHubId)) {
        return { allowed: false, reason: "Sender Hub is not a member of the resync Room" };
      }
      return { allowed: true };
    }

    if (payload.messageType === "a2a_call" || payload.messageType === "chat") {
      const room = this.repository
        .listConversations({ type: "cross_hub" })
        .find(
          (conversation) =>
            conversation.id === payload.conversationId ||
            conversation.relayRoomId === payload.conversationId,
        );
      if (!room?.relayRoomId) {
        return { allowed: false, reason: "Cross-Hub Room membership is required" };
      }
      if (!this.registry?.isHubInRoom(room.relayRoomId, fromHubId)) {
        return { allowed: false, reason: "Sender Hub is not a current Room member" };
      }
      // An empty toAgentId counts as absent, matching how stringMetadata treats "".
      const targetAgentId =
        nonEmptyString(payload.toAgentId) ?? stringMetadata(payload.metadata, "targetAgentId");
      if (targetAgentId) {
        const agent = this.repository.getAgentRow(targetAgentId);
        if (!agent) {
          return { allowed: false, reason: "Target agent not found" };
        }
        if (agent.ownerType === "remote") {
          return { allowed: false, reason: "Cannot call remote agent via inbound" };
        }
        if (agent.disabled) {
          return { allowed: false, reason: "Target agent is disabled" };
        }
        const membership = this.repository
          .getConversationMembers(room.id)
          .find((candidate) => candidate.id === targetAgentId);
        if (!membership) {
          return { allowed: false, reason: "Target agent is not admitted to the Room" };
        }
        if (membership.visibility === "private") {
          return { allowed: false, reason: "Target agent is private" };
        }
      }
    }

    return { allowed: true };
  }
}

function stringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  return nonEmptyString(metadata?.[key]);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
