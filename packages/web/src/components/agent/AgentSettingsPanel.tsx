import { useEffect, useState } from "react";
import type { Agent } from "@agentlink/shared";
import { FileText, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { PasswordInput } from "@/components/common/PasswordInput";
import { LogViewer } from "@/components/common/LogViewer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUS_COLORS } from "@/constants/agent";
import { changeLanguage, currentLanguage, type AppLanguage } from "@/i18n";
import { getThemePreference, setThemePreference, type ThemePreference } from "@/services/theme";
import {
  announceUpdate,
  checkForUpdates,
  getUpdateChannel,
  setUpdateChannel,
  type UpdateChannel,
} from "@/services/updater";
import { useAgentStore } from "@/store/agentStore";
import { track } from "@/utils/analytics";

type AgentWithConfig = Agent & { config?: Record<string, unknown> };

function configText(agent: Agent, key: string): string {
  const value = (agent as AgentWithConfig).config?.[key];
  return typeof value === "string" ? value : "";
}

export function AgentSettingsPanel() {
  const { t } = useTranslation(["common", "settings", "errors"]);
  const agents = useAgentStore((state) => state.agents);
  const selectedAgentId = useAgentStore((state) => state.selectedAgentId);
  const updateAgent = useAgentStore((state) => state.updateAgent);
  const clearSelectedAgent = useAgentStore((state) => state.clearSelectedAgent);
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const [displayedAgent, setDisplayedAgent] = useState<Agent | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [initialSystemPrompt, setInitialSystemPrompt] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
  const [updateChannel, setChannel] = useState<UpdateChannel>(getUpdateChannel);
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedAgent) return;
    const prompt = configText(selectedAgent, "systemPrompt");
    setDisplayedAgent(selectedAgent);
    setName(selectedAgent.name);
    setDescription(selectedAgent.description);
    setSystemPrompt(prompt);
    setInitialSystemPrompt(prompt);
    setModel(selectedAgent.model ?? configText(selectedAgent, "model"));
    setApiKey("");
    setError(null);
  }, [selectedAgent]);

  if (!displayedAgent) return null;

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t("settings:errors.nameRequired"));
      return;
    }

    setIsSaving(true);
    setError(null);

    const config: Record<string, unknown> = {};
    if (model !== (displayedAgent.model ?? "")) config.model = model;
    if (systemPrompt !== initialSystemPrompt) config.systemPrompt = systemPrompt;
    if (apiKey) config.apiKey = apiKey;

    try {
      await updateAgent(displayedAgent.id, {
        name: trimmedName,
        description: description.trim(),
        ...(Object.keys(config).length > 0 ? { config } : {}),
      });
      track("settings_changed", { section: "agent", agentId: displayedAgent.id });
      clearSelectedAgent();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("errors:saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCheckForUpdates = async () => {
    setIsCheckingForUpdates(true);
    setUpdateStatus(null);
    try {
      const update = await checkForUpdates();
      if (update) {
        announceUpdate(update);
        setUpdateStatus(t("settings:updates.available", { version: update.version }));
      } else {
        setUpdateStatus(t("settings:updates.upToDate"));
      }
    } catch {
      setUpdateStatus(t("settings:updates.checkFailed"));
    } finally {
      setIsCheckingForUpdates(false);
    }
  };

  return (
    <Dialog
      open={Boolean(selectedAgentId)}
      onOpenChange={(open) => {
        if (!open && !isSaving) clearSelectedAgent();
      }}
    >
      <DialogContent
        variant="drawer"
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => {
          if (isSaving) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isSaving) event.preventDefault();
        }}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <DialogTitle id="agent-settings-title">{t("settings:title")}</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={clearSelectedAgent}
            disabled={isSaving}
            aria-label={t("common:buttons.close")}
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6">
          <div className="mb-6 flex items-center gap-4 rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-4">
            <AgentAvatar name={displayedAgent.name} src={displayedAgent.avatar} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-[var(--text-primary)]">
                {displayedAgent.name}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-tertiary)]">
                <span className="rounded bg-[var(--bg-elevated)] px-2 py-0.5 uppercase text-[var(--text-secondary)]">
                  {displayedAgent.type}
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className={`h-2 w-2 rounded-full ${STATUS_COLORS[displayedAgent.status]}`}
                  />
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
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                {t("settings:description")}
              </span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
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
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={t("settings:modelPlaceholder")}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                {t("settings:systemPrompt")}
              </span>
              <textarea
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                rows={6}
                placeholder={t("settings:systemPromptPlaceholder")}
                className="w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-2.5 text-sm leading-6 text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent-color)] focus:ring-2 focus:ring-indigo-500/20"
              />
            </label>

            <div>
              <PasswordInput
                label={t("settings:apiKey")}
                value={apiKey}
                onChange={setApiKey}
                placeholder={t("settings:apiKeyPlaceholder")}
              />
              <p className="mt-2 text-xs text-[var(--text-muted)]">{t("settings:apiKeyHelp")}</p>
            </div>

            <fieldset className="space-y-4 rounded-xl border border-[var(--border-color)] p-4">
              <legend className="px-1 text-sm font-semibold text-[var(--text-primary)]">
                {t("settings:preferences")}
              </legend>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                  {t("settings:theme")}
                </span>
                <Select
                  value={theme}
                  onValueChange={(preference: ThemePreference) => {
                    setTheme(preference);
                    setThemePreference(preference);
                    track("settings_changed", { section: "theme", value: preference });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dark">{t("settings:themeOptions.dark")}</SelectItem>
                    <SelectItem value="light">{t("settings:themeOptions.light")}</SelectItem>
                    <SelectItem value="system">{t("settings:themeOptions.system")}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                  {t("settings:language")}
                </span>
                <Select
                  value={currentLanguage()}
                  onValueChange={(language: AppLanguage) => {
                    track("settings_changed", { section: "language", value: language });
                    void changeLanguage(language);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh-CN">{t("settings:languageOptions.zh-CN")}</SelectItem>
                    <SelectItem value="en">{t("settings:languageOptions.en")}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                  {t("settings:updates.channel")}
                </span>
                <Select
                  value={updateChannel}
                  onValueChange={(channel: UpdateChannel) => {
                    setChannel(channel);
                    setUpdateChannel(channel);
                    setUpdateStatus(null);
                    track("settings_changed", { section: "updateChannel", value: channel });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stable">{t("settings:updates.channels.stable")}</SelectItem>
                    <SelectItem value="beta">{t("settings:updates.channels.beta")}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </fieldset>

            <fieldset className="rounded-xl border border-[var(--border-color)] p-4">
              <legend className="px-1 text-sm font-semibold text-[var(--text-primary)]">
                {t("settings:diagnostics")}
              </legend>
              <p className="mb-3 text-xs leading-5 text-[var(--text-muted)]">
                {t("settings:logs.description")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setIsLogViewerOpen(true)}>
                  <FileText aria-hidden="true" className="h-4 w-4" />
                  {t("settings:logs.view")}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void handleCheckForUpdates()}
                  disabled={isCheckingForUpdates}
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={`h-4 w-4 ${isCheckingForUpdates ? "animate-spin" : ""}`}
                  />
                  {isCheckingForUpdates
                    ? t("settings:updates.checking")
                    : t("settings:updates.check")}
                </Button>
              </div>
              {updateStatus && (
                <p className="mt-3 text-xs text-[var(--text-secondary)]" role="status">
                  {updateStatus}
                </p>
              )}
            </fieldset>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2.5 text-sm text-red-300"
              >
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-[var(--border-color)] bg-[var(--bg-surface)] px-5 py-4">
          <Button variant="secondary" onClick={clearSelectedAgent} disabled={isSaving}>
            {t("common:buttons.cancel")}
          </Button>
          <Button onClick={() => void handleSave()} disabled={isSaving} className="min-w-24">
            {isSaving ? t("common:buttons.saving") : t("common:buttons.save")}
          </Button>
        </div>
      </DialogContent>
      <LogViewer open={isLogViewerOpen} onOpenChange={setIsLogViewerOpen} />
    </Dialog>
  );
}
