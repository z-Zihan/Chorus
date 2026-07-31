import { AgentAvatar } from "./AgentAvatar";
import type { Agent } from "@/store/agentStore";

const STATUS_DOT: Record<string, string> = {
  online: "bg-green-500",
  offline: "bg-gray-500",
  busy: "bg-yellow-500",
  error: "bg-red-500",
};

const STATUS_TEXT: Record<string, string> = {
  online: "在线",
  offline: "离线",
  busy: "忙碌",
  error: "错误",
};

interface Props {
  agent: Agent;
  onClick?: () => void;
  selected?: boolean;
}

export function AgentCard({ agent, onClick, selected }: Props) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
        selected
          ? "border-indigo-500 bg-gray-800"
          : "border-gray-800 bg-gray-900 hover:border-gray-700 hover:bg-gray-800/60"
      }`}
    >
      <AgentAvatar name={agent.name} src={agent.avatar} size="md" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-100">
            {agent.name}
          </span>
          <span
            className={`h-2 w-2 flex-shrink-0 rounded-full ${
              STATUS_DOT[agent.status] ?? STATUS_DOT.offline
            }`}
          />
        </div>
        {agent.description && (
          <p className="truncate text-xs text-gray-500">
            {agent.description}
          </p>
        )}
        <div className="mt-1 flex items-center gap-2 text-xs text-gray-600">
          <span>{STATUS_TEXT[agent.status] ?? "未知"}</span>
          {agent.config?.model && (
            <>
              <span>·</span>
              <span>{agent.config.model}</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}
