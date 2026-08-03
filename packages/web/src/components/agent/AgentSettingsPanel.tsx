import { useEffect, useState } from "react";
import type { Agent } from "@agentlink/shared";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { AgentSettingsExtras } from "@/components/agent/AgentSettingsExtras";
import { PasswordInput } from "@/components/common/PasswordInput";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { STATUS_COLORS } from "@/constants/agent";
import { useAgentSettings } from "@/hooks/useAgentSettings";
import { useAgentStore } from "@/store/agentStore";

export function AgentSettingsPanel() {
  const { t } = useTranslation(["common", "settings"]);
  const agents = useAgentStore((state) => state.agents);
  const selectedAgentId = useAgentStore((state) => state.selectedAgentId);
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const [displayedAgent, setDisplayedAgent] = useState<Agent | null>(null);
  const { fields, setField, save, cancel, isSaving, error } = useAgentSettings(selectedAgentId);

  useEffect(() => {
    if (selectedAgent) setDisplayedAgent(selectedAgent);
  }, [selectedAgent]);

  if (!displayedAgent) return null;

  return (
    <Dialog open={false} onOpenChange={() => {}}>
      <DialogContent
        variant="drawer"
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => { if (isSaving) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (isSaving) event.preventDefault(); }}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <DialogTitle id="agent-settings-title">{t("settings:title")}</DialogTitle>
          <Button variant="ghost" size="icon" onClick={cancel} disabled={isSaving} aria-label={t("common:buttons.close")}>
            <X aria-hidden="true" className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6">
          <div className="mb-6 flex items-center gap-4 rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-4">
            <AgentAvatar name={displayedAgent.name} src={displayedAgent.avatar} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-[var(--text-primary)]">{displayedAgent.name}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-tertiary)]">
                <span className="rounded bg-[var(--bg-elevated)] px-2 py-0.5 uppercase text-[var(--text-secondary)]">
                  {displayedAgent.type}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${STATUS_COLORS[displayedAgent.status]}`} />
                  {t(`common:status.${displayedAgent.status}`)}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                {t("settings:name")}
              </span>
              <Input value={fields.name} onChange={(event) => setField("name", event.target.value)} maxLength={100} />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                {t("settings:description")}
              </span>
              <textarea
                value={fields.description}
                onChange={(event) => setField("description", event.target.value)}
                rows={3}
                maxLength={500}
                className="w-full resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-color)] focus:ring-2 focus:ring-indigo-500/20"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                {t("settings:model")}
              </span>
              <Input
                value={fields.model}
                onChange={(event) => setField("model", event.target.value)}
                placeholder={t("settings:modelPlaceholder")}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                {t("settings:systemPrompt")}
              </span>
              <textarea
                value={fields.systemPrompt}
                onChange={(event) => setField("systemPrompt", event.target.value)}
                rows={6}
                placeholder={t("settings:systemPromptPlaceholder")}
                className="w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-2.5 text-sm leading-6 text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent-color)] focus:ring-2 focus:ring-indigo-500/20"
              />
            </label>

            <div>
              <PasswordInput
                label={t("settings:apiKey")}
                value={fields.apiKey}
                onChange={(value) => setField("apiKey", value)}
                placeholder={t("settings:apiKeyPlaceholder")}
              />
              <p className="mt-2 text-xs text-[var(--text-muted)]">{t("settings:apiKeyHelp")}</p>
            </div>

            <AgentSettingsExtras />
            {error && <div role="alert" className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2.5 text-sm text-red-300">
              {error}
            </div>}
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-[var(--border-color)] bg-[var(--bg-surface)] px-5 py-4">
          <Button variant="secondary" onClick={cancel} disabled={isSaving}>
            {t("common:buttons.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={isSaving} className="min-w-24">
            {isSaving ? t("common:buttons.saving") : t("common:buttons.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
