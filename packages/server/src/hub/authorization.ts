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
      const targetAgentId = payload.toAgentId ?? stringMetadata(payload.metadata, "targetAgentId");
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
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
