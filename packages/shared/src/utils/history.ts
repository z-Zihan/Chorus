import type { HistoryTruncationConfig, Message } from "../types";

export function truncateHistory(history: Message[], config: HistoryTruncationConfig): Message[] {
  let result = history.slice(-Math.max(1, config.maxMessages));
  const maxChars = Math.max(1, config.maxTokens) * 4;
  let totalChars = result.reduce((sum, message) => sum + message.content.length, 0);

  while (totalChars > maxChars && result.length > 1) {
    totalChars -= result[0]?.content.length ?? 0;
    result = result.slice(1);
  }
  return result;
}

export interface ParsedMentions {
  mentionedAgents: string[];
  mentionedAgentNames: string[];
}

/**
 * Parse mention tokens and, when the conversation's agent IDs are supplied,
 * separate direct ID mentions from display-name mentions. Agent IDs and
 * mention-safe names share the same character set, so the caller's ID list is
 * the only unambiguous way to tell them apart.
 */
export function parseMentions(content: string, agentIds?: readonly string[]): ParsedMentions {
  const mentions = [
    ...content.matchAll(/(?<![A-Za-z0-9_])@([A-Za-z0-9][A-Za-z0-9-]*)(?![A-Za-z0-9_-])/g),
  ]
    .map((match) => match[1] ?? "")
    .filter(Boolean);
  const uniqueMentions = [...new Set(mentions)];

  if (!agentIds) {
    return { mentionedAgents: uniqueMentions, mentionedAgentNames: [] };
  }

  const knownIds = new Set(agentIds);
  return {
    mentionedAgents: uniqueMentions.filter((mention) => knownIds.has(mention)),
    mentionedAgentNames: uniqueMentions.filter((mention) => !knownIds.has(mention)),
  };
}
