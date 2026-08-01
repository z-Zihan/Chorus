import { useEffect, useState } from "react";
import type { Agent } from "@agentlink/shared";
import { Pause, Play, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";
import { useAgentStore } from "@/store/agentStore";
import { logger } from "@/utils/logger";

export function AgentManager() {
  const { t } = useTranslation("common");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setAgents(await api.getAgents(true));
    } catch (error) {
      logger.error("Failed to load installed agents", error);
    }
  };

  useEffect(() => {
    let active = true;
    void api.getAgents(true)
      .then((installedAgents) => { if (active) setAgents(installedAgents); })
      .catch((error: unknown) => logger.error("Failed to load installed agents", error));
    return () => { active = false; };
  }, []);

  const setDisabled = async (agent: Agent, disabled: boolean) => {
    setBusyId(agent.id);
    try {
      await api.setAgentDisabled(agent.id, disabled);
      await Promise.all([refresh(), useAgentStore.getState().fetchAgents()]);
    } finally {
      setBusyId(null);
    }
  };

  const deleteAgent = async () => {
    if (!agentToDelete) return;
    setBusyId(agentToDelete.id);
    try {
      await api.deleteAgent(agentToDelete.id);
      useAgentStore.getState().clearSelectedAgent();
      await Promise.all([refresh(), useAgentStore.getState().fetchAgents()]);
      setAgentToDelete(null);
    } finally {
      setBusyId(null);
    }
  };

  if (agents.length === 0) {
    return <p className="py-12 text-center text-sm text-[var(--text-muted)]">{t("catalog.noInstalled")}</p>;
  }

  return (
    <>
      <div className="space-y-2">
        {agents.map((agent) => (
          <div key={agent.id} className="flex items-center gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-3">
            <AgentAvatar name={agent.name} src={agent.avatar} size="md" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-[var(--text-primary)]">{agent.name}</div>
              <div className="text-xs text-[var(--text-tertiary)]">
                {agent.disabled ? t("catalog.disabled") : t("catalog.enabled")}
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={busyId === agent.id}
              onClick={() => void setDisabled(agent, !agent.disabled)}
            >
              {agent.disabled ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {agent.disabled ? t("catalog.enable") : t("catalog.disable")}
            </Button>
            <Button variant="danger" size="icon" disabled={busyId === agent.id} onClick={() => setAgentToDelete(agent)} aria-label={t("catalog.deleteAgent")}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(agentToDelete)}
        title={t("catalog.deleteTitle")}
        message={t("catalog.deleteWarning")}
        confirmLabel={t("buttons.delete")}
        isConfirming={busyId === agentToDelete?.id}
        onConfirm={() => void deleteAgent()}
        onCancel={() => setAgentToDelete(null)}
      />
    </>
  );
}
