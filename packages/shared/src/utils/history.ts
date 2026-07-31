import type { HistoryTruncationConfig, Message } from "../types";

export function truncateHistory(
  history: Message[],
  config: HistoryTruncationConfig,
): Message[] {
  let result = history.slice(-Math.max(1, config.maxMessages));
  const maxChars = Math.max(1, config.maxTokens) * 4;
  let totalChars = result.reduce((sum, message) => sum + message.content.length, 0);

  while (totalChars > maxChars && result.length > 1) {
    totalChars -= result[0]?.content.length ?? 0;
    result = result.slice(1);
  }
  return result;
}

export function parseMentions(content: string): { text: string; mentionedAgents: string[] } {
  const mentionedAgents = [...content.matchAll(/@(\w[\w-]*)/g)].map((match) => match[1] ?? "");
  return {
    text: content.replace(/@\w[\w-]*/g, "").replace(/\s+/g, " ").trim(),
    mentionedAgents: [...new Set(mentionedAgents.filter(Boolean))],
  };
}
