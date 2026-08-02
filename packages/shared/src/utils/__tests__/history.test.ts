import type { Message } from "../../types";
import { describe, expect, it } from "vitest";
import { parseMentions, truncateHistory } from "../history";

function message(id: string, content = id): Message {
  return {
    id,
    conversationId: "conversation-1",
    fromType: "user",
    fromId: "user",
    content,
    timestamp: Number(id.replace(/\D/g, "")) || 0,
    status: "done",
  };
}

describe("truncateHistory", () => {
  it("returns an empty array for empty history", () => {
    expect(truncateHistory([], { maxMessages: 10, maxTokens: 100 })).toEqual([]);
  });

  it("keeps a short history unchanged", () => {
    const history = [message("1"), message("2"), message("3")];

    expect(truncateHistory(history, { maxMessages: 5, maxTokens: 100 })).toEqual(history);
  });

  it("keeps only the newest messages when history exceeds maxMessages", () => {
    const history = [message("1"), message("2"), message("3"), message("4")];

    expect(truncateHistory(history, { maxMessages: 2, maxTokens: 100 })).toEqual([
      history[2],
      history[3],
    ]);
  });

  it("drops the oldest messages when content exceeds maxTokens", () => {
    const history = [
      message("1", "123456"),
      message("2", "abcdef"),
      message("3", "latest"),
    ];

    expect(truncateHistory(history, { maxMessages: 10, maxTokens: 2 })).toEqual([history[2]]);
  });

  it("always preserves a single message", () => {
    const history = [message("1", "a".repeat(100))];

    expect(truncateHistory(history, { maxMessages: 10, maxTokens: 1 })).toEqual(history);
  });
});

describe("parseMentions", () => {
  it("extracts unique agent ids", () => {
    expect(parseMentions("Please ask @code-reviewer and @security then @code-reviewer again"))
      .toEqual({
        mentionedAgents: ["code-reviewer", "security"],
        mentionedAgentNames: [],
      });
  });

  it("separates known agent ids from mention-safe agent names", () => {
    expect(parseMentions("Ask @reviewer-id and @Security-Reviewer", ["reviewer-id"]))
      .toEqual({
        mentionedAgents: ["reviewer-id"],
        mentionedAgentNames: ["Security-Reviewer"],
      });
  });

  it("supports alphanumeric and hyphenated IDs but not underscores", () => {
    expect(parseMentions("@agent-42 @Agent7 @not_an_id"))
      .toEqual({
        mentionedAgents: ["agent-42", "Agent7"],
        mentionedAgentNames: [],
      });
  });

  it("returns the original text when there are no mentions", () => {
    expect(parseMentions("A message without mentions")).toEqual({
      mentionedAgents: [],
      mentionedAgentNames: [],
    });
  });
});
