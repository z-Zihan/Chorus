import type { AgentStatus } from "@agentlink/shared";

export const STATUS_COLORS: Record<AgentStatus, string> = {
  online: "bg-green-500",
  offline: "bg-gray-500",
  busy: "bg-yellow-500",
  error: "bg-red-500",
};

export const STATUS_LABELS: Record<AgentStatus, string> = {
  online: "在线",
  offline: "离线",
  busy: "忙碌",
  error: "错误",
};
