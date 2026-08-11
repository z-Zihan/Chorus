import type { AgentStatus } from "@chorus/shared";

export const STATUS_COLORS: Record<AgentStatus, string> = {
  online: "bg-[var(--status-online)]",
  offline: "bg-[var(--status-offline)]",
  busy: "bg-[var(--status-busy)]",
  error: "bg-[var(--status-error)]",
};
