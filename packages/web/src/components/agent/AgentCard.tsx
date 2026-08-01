import { AgentAvatar } from "./AgentAvatar";
import type { Agent } from "@/store/agentStore";
import { useTranslation } from "react-i18next";
import { STATUS_COLORS } from "@/constants/agent";

interface Props {
  agent: Agent;
  onClick?: () => void;
  selected?: boolean;
}

export function AgentCard({ agent, onClick, selected }: Props) {
  const { t } = useTranslation("common");
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
        selected
          ? "border-[var(--accent-color)] bg-[var(--bg-active)]"
          : "border-[var(--border-color)] bg-[var(--bg-surface)] hover:border-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
      }`}
    >
      <AgentAvatar name={agent.name} src={agent.avatar} size="md" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-[var(--text-primary)]">
            {agent.name}
          </span>
          <span
            className={`h-2 w-2 flex-shrink-0 rounded-full ${
              STATUS_COLORS[agent.status]
            }`}
          />
        </div>
        {agent.description && (
          <p className="truncate text-xs text-[var(--text-tertiary)]">
            {agent.description}
          </p>
        )}
        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span>{t(`status.${agent.status}`, { defaultValue: t("status.unknown") })}</span>
          {agent.model && (
            <>
              <span>·</span>
              <span>{agent.model}</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}
