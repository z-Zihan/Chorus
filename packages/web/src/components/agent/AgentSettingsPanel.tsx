import { useEffect, useState } from "react";
import type { Agent } from "@agentlink/shared";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { PasswordInput } from "@/components/common/PasswordInput";
import { STATUS_COLORS } from "@/constants/agent";
import { changeLanguage, currentLanguage, type AppLanguage } from "@/i18n";
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from "@/services/theme";
import { useAgentStore } from "@/store/agentStore";

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
  const clearSelectedAgent = useAgentStore(
    (state) => state.clearSelectedAgent
  );
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const [displayedAgent, setDisplayedAgent] = useState<Agent | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [initialSystemPrompt, setInitialSystemPrompt] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);

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

  useEffect(() => {
    if (!selectedAgentId) {
      setIsVisible(false);
      return;
    }

    const frame = window.requestAnimationFrame(() => setIsVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, [selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) clearSelectedAgent();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearSelectedAgent, isSaving, selectedAgentId]);

  if (!displayedAgent) return null;

  const isOpen = Boolean(selectedAgentId) && isVisible;

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
      clearSelectedAgent();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : t("errors:saveFailed")
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      aria-hidden={!isOpen}
      className={`fixed inset-0 z-50 transition ${
        isOpen ? "pointer-events-auto" : "pointer-events-none"
      }`}
    >
      <button
        type="button"
        aria-label={t("settings:closeSettings")}
        onClick={clearSelectedAgent}
        disabled={isSaving}
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200 ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-settings-title"
        className={`absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-[var(--border-color)] bg-[var(--bg-surface)] shadow-2xl transition-transform duration-200 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <h2 id="agent-settings-title" className="font-semibold text-[var(--text-primary)]">
            {t("settings:title")}
          </h2>
          <button
            type="button"
            onClick={clearSelectedAgent}
            disabled={isSaving}
            aria-label={t("common:buttons.close")}
            className="rounded-lg p-2 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-6">
          <div className="mb-6 flex items-center gap-4 rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-4">
            <AgentAvatar
              name={displayedAgent.name}
              src={displayedAgent.avatar}
              size="lg"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-[var(--text-primary)]">
                {displayedAgent.name}
              </div>
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
              <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">{t("settings:name")}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-color)] focus:ring-2 focus:ring-indigo-500/20"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">{t("settings:description")}</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                maxLength={500}
                className="w-full resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-color)] focus:ring-2 focus:ring-indigo-500/20"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">{t("settings:model")}</span>
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={t("settings:modelPlaceholder")}
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent-color)] focus:ring-2 focus:ring-indigo-500/20"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">{t("settings:systemPrompt")}</span>
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
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                {t("settings:apiKeyHelp")}
              </p>
            </div>

            <fieldset className="space-y-4 rounded-xl border border-[var(--border-color)] p-4">
              <legend className="px-1 text-sm font-semibold text-[var(--text-primary)]">
                {t("settings:preferences")}
              </legend>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                  {t("settings:theme")}
                </span>
                <select
                  value={theme}
                  onChange={(event) => {
                    const preference = event.target.value as ThemePreference;
                    setTheme(preference);
                    setThemePreference(preference);
                  }}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                >
                  <option value="dark">{t("settings:themeOptions.dark")}</option>
                  <option value="light">{t("settings:themeOptions.light")}</option>
                  <option value="system">{t("settings:themeOptions.system")}</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
                  {t("settings:language")}
                </span>
                <select
                  value={currentLanguage()}
                  onChange={(event) => void changeLanguage(event.target.value as AppLanguage)}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-color)]"
                >
                  <option value="zh-CN">{t("settings:languageOptions.zh-CN")}</option>
                  <option value="en">{t("settings:languageOptions.en")}</option>
                </select>
              </label>
            </fieldset>

            {error && (
              <div role="alert" className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2.5 text-sm text-red-300">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-[var(--border-color)] bg-[var(--bg-surface)] px-5 py-4">
          <button
            type="button"
            onClick={clearSelectedAgent}
            disabled={isSaving}
            className="rounded-lg border border-[var(--border-color)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            {t("common:buttons.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="min-w-24 rounded-lg bg-[var(--accent-color)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-wait disabled:opacity-60"
          >
            {isSaving ? t("common:buttons.saving") : t("common:buttons.save")}
          </button>
        </div>
      </aside>
    </div>
  );
}
