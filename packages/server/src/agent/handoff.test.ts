import type { Message } from "@chorus/shared";
import { describe, expect, it } from "vitest";
import { buildAgentHandoff, findLatestUserObjective } from "./handoff";

function message(
  fromType: Message["fromType"],
  fromId: string,
  content: string,
  timestamp: number,
): Message {
  return {
    id: String(timestamp),
    conversationId: "conversation-1",
    fromType,
    fromId,
    content,
    timestamp,
    status: "done",
  };
}

describe("Agent handoff", () => {
  it("packages the objective, relevant context, request, and quality contract", () => {
    const history = [
      message("user", "user", "Ship a verified migration", 1),
      message("agent", "writer", "Implemented schema changes in migration 12.", 2),
    ];

    const result = buildAgentHandoff({
      objective: "Ship a verified migration",
      request: "Review migration 12 for rollback safety",
      fromAgent: "Writer",
      toAgent: "Reviewer",
      history,
      round: 3,
      maxRounds: 12,
    });

    expect(result).toContain("Original objective: Ship a verified migration");
    expect(result).toContain("Automatic handoff: 3/12");
    expect(result).toContain("Specific request: Review migration 12 for rollback safety");
    expect(result).toContain("Implemented schema changes in migration 12");
    expect(result).toContain("do not invent facts");
    expect(result).toContain("Do not reply with greetings");
  });

  it("does not wrap a handoff again after cross-Hub transport", () => {
    const original = "[Chorus Agent handoff]\nOriginal objective: Verify release";
    expect(
      buildAgentHandoff({
        objective: "Verify release",
        request: original,
        fromAgent: "Remote",
        toAgent: "Local",
        history: [],
      }),
    ).toBe(original);
  });

  it("uses the latest user message as the objective", () => {
    const history = [
      message("user", "user", "Old task", 1),
      message("agent", "writer", "Done", 2),
      message("user", "user", "Current task", 3),
    ];
    expect(findLatestUserObjective(history, "fallback")).toBe("Current task");
  });
});
