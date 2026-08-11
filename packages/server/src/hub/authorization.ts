import type { HubPayload } from "@chorus/shared";
import type { Repository } from "../db/repository.js";
import type { TrustStore } from "./trust-store.js";

export type AuthorizationResult = { allowed: true } | { allowed: false; reason: string };

export class AuthorizationService {
  constructor(
    private readonly trustStore: TrustStore,
    private readonly repository: Repository,
  ) {}

  /** Check if an inbound payload is authorized to perform its action. */
  authorize(fromHubId: string, payload: HubPayload): AuthorizationResult {
    const hub = this.trustStore.get(fromHubId);
    if (!hub || hub.trustLevel === "blocked") {
      return { allowed: false, reason: "Hub is blocked or unknown" };
    }

    if (hub.trustLevel === "pending") {
      return payload.messageType === "directory_request"
        ? { allowed: true }
        : { allowed: false, reason: "Hub is pending pairing" };
    }

    if (payload.messageType === "a2a_call" || payload.messageType === "chat") {
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
