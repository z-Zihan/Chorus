import type { Message } from "@chorus/shared";

const MAX_OBJECTIVE_LENGTH = 1_200;
const MAX_REQUEST_LENGTH = 2_400;
const MAX_CONTEXT_ITEMS = 5;
const MAX_CONTEXT_ITEM_LENGTH = 320;

export interface AgentHandoffInput {
  objective: string;
  request: string;
  fromAgent: string;
  toAgent: string;
  history: Message[];
  round?: number;
  maxRounds?: number;
}

/**
 * Build a compact, task-oriented handoff so another Agent receives the goal,
 * relevant evidence, and a concrete quality bar instead of a chatty mention.
 */
export function buildAgentHandoff(input: AgentHandoffInput): string {
  if (input.request.trimStart().startsWith("[Chorus Agent handoff]")) return input.request;
  const context = input.history
    .filter((message) => message.content.trim() && !message.content.startsWith("[system]"))
    .slice(-MAX_CONTEXT_ITEMS)
    .map((message) => {
      const speaker = message.fromType === "user" ? "User" : message.fromId;
      return `- ${speaker}: ${compact(message.content, MAX_CONTEXT_ITEM_LENGTH)}`;
    });
  const round =
    input.round !== undefined && input.maxRounds !== undefined
      ? `${input.round}/${input.maxRounds}`
      : "nested A2A call";

  return `[Chorus Agent handoff]
Original objective: ${compact(input.objective, MAX_OBJECTIVE_LENGTH)}
From: ${input.fromAgent}
To: ${input.toAgent}
Automatic handoff: ${round}
Specific request: ${compact(input.request, MAX_REQUEST_LENGTH)}

Relevant recent context:
${context.length > 0 ? context.join("\n") : "- No additional context was recorded."}

Required response quality:
1. Work on the specific request and return concrete findings, decisions, evidence, or an artifact.
2. State assumptions and uncertainty; do not invent facts or claim unverified work is complete.
3. Do not reply with greetings, thanks, acknowledgements, or open-ended small talk.
4. Mention or call another Agent only for a specific unresolved dependency. Include the missing context and expected deliverable.
5. If the objective is complete or you have no new work to add, return a concise final result without triggering another Agent.`;
}

export function findLatestUserObjective(history: Message[], fallback: string): string {
  return (
    [...history].reverse().find((message) => message.fromType === "user" && message.content.trim())
      ?.content ?? fallback
  );
}

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}
