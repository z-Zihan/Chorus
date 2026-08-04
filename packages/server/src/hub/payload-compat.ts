import type { HubPayload } from "@agentlink/shared";

/** Normalize a supported legacy payload into the v2 shape used internally. */
export function normalizeHubPayload(raw: Record<string, unknown>): HubPayload {
  const version = raw.protocolVersion ?? 1;

  if (typeof version === "number" && version < 2) {
    return {
      protocolVersion: 2,
      messageType: raw.messageType as HubPayload["messageType"],
      conversationId: raw.conversationId as string | undefined,
      messageId: raw.messageId as string,
      content: raw.content as string | undefined,
      fromUserId: (raw.fromUserId as string | undefined) ?? "unknown",
      fromUserName: (raw.fromUserName as string | undefined) ?? "Unknown",
      toUserId: raw.toUserId as string | undefined,
      fromAgentId: (raw.agentId as string | undefined) ?? (raw.fromAgentId as string | undefined),
      toAgentId: raw.toAgentId as string | undefined,
      metadata: raw.metadata as Record<string, unknown> | undefined,
    };
  }

  return raw as unknown as HubPayload;
}

export function isV2Payload(payload: HubPayload): boolean {
  return payload.protocolVersion === 2;
}

/** Only protocol v1 (including its omitted version field) and v2 are accepted. */
export function rejectIncompatibleVersion(payload: HubPayload): boolean {
  const version = (payload as unknown as { protocolVersion?: unknown }).protocolVersion ?? 1;
  return version !== 1 && version !== 2;
}
