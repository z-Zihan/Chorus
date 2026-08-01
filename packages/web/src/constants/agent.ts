import type { AgentStatus } from "@agentlink/shared";

export const STATUS_COLORS: Record<AgentStatus, string> = {
  online: "bg-green-500",
  offline: "bg-[var(--text-tertiary)]",
  busy: "bg-yellow-500",
  error: "bg-red-500",
};
