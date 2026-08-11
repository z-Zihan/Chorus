import type { HubPayload } from "@chorus/shared";
import { describe, expect, it } from "vitest";
import { isV2Payload, normalizeHubPayload, rejectIncompatibleVersion } from "./payload-compat.js";

describe("Hub payload compatibility", () => {
  it("normalizes an unversioned v1 payload and maps agentId to fromAgentId", () => {
    expect(
      normalizeHubPayload({
        messageType: "chat",
        conversationId: "conversation-1",
        messageId: "message-1",
        content: "hello",
        agentId: "legacy-agent",
      }),
    ).toEqual({
      protocolVersion: 2,
      messageType: "chat",
      conversationId: "conversation-1",
      messageId: "message-1",
      content: "hello",
      fromUserId: "unknown",
      fromUserName: "Unknown",
      toUserId: undefined,
      fromAgentId: "legacy-agent",
      toAgentId: undefined,
      metadata: undefined,
    });
  });

  it("keeps an existing v2 payload intact", () => {
    const payload: HubPayload = {
      protocolVersion: 2,
      messageType: "a2a_call",
      messageId: "message-2",
      fromUserId: "usr_sender",
      fromUserName: "Sender",
      fromAgentId: "agent-a",
      toAgentId: "agent-b",
    };

    expect(normalizeHubPayload(payload as unknown as Record<string, unknown>)).toBe(payload);
    expect(isV2Payload(payload)).toBe(true);
  });

  it("accepts only v1 and v2 protocol versions", () => {
    const incompatible = (protocolVersion?: number) =>
      rejectIncompatibleVersion({ protocolVersion } as unknown as HubPayload);

    expect(incompatible()).toBe(false);
    expect(incompatible(1)).toBe(false);
    expect(incompatible(2)).toBe(false);
    expect(incompatible(0)).toBe(true);
    expect(incompatible(3)).toBe(true);
  });
});
