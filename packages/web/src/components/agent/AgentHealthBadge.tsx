import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgentStore, type AgentHealthState } from "@/store/agentStore";

const HEALTH_COLORS: Record<AgentHealthState, string> = {
  healthy: "bg-[var(--status-online)]",
  checking: "bg-[var(--status-busy)]",
  unhealthy: "bg-[var(--status-error)]",
};

interface AgentHealthBadgeProps {
  agentId: string;
}

export function AgentHealthBadge({ agentId }: AgentHealthBadgeProps) {
  const { t } = useTranslation("common");
  const health = useAgentStore((state) => state.healthStatus[agentId]);
  const status = health?.status ?? "checking";
  const statusLabel = t(`health.${status}`);
  const lastCheck = health?.lastCheck
    ? new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(health.lastCheck)
    : null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="status"
            tabIndex={0}
            aria-label={t("health.ariaLabel", { status: statusLabel })}
            className={`h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-[var(--bg-surface)] ${HEALTH_COLORS[status]}`}
          />
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-64 space-y-1">
          <p className="font-medium">{statusLabel}</p>
          {lastCheck && (
            <p className="text-[var(--text-secondary)]">
              {t("health.lastCheck", { time: lastCheck })}
            </p>
          )}
          {status === "unhealthy" && (
            <p className="text-[var(--status-error)]">
              {health?.reason || t("health.unavailableReason")}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
