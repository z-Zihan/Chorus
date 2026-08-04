import { useEffect, useState } from "react";
import {
  Activity,
  BookOpen,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  FileText,
  Info,
  Languages,
  Network,
  Palette,
  RefreshCw,
  Shield,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useTranslation } from "react-i18next";
import { PrivacySettings } from "@/components/settings/PrivacySettings";
import { LogViewer } from "@/components/common/LogViewer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { changeLanguage, currentLanguage, type AppLanguage } from "@/i18n";
import { api, type CredentialStatus } from "@/services/api";
import { getThemePreference, setThemePreference, type ThemePreference } from "@/services/theme";
import { announceUpdate, checkForUpdates } from "@/services/updater";
import { track } from "@/utils/analytics";

const APP_VERSION = "0.1.0";
const HOMEPAGE_URL = "https://github.com/z-Zihan/agent-link";

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsTab = "appearance" | "language" | "security" | "privacy" | "hub" | "diagnostics" | "about";

export function SettingsPanel({ open, onOpenChange }: SettingsPanelProps) {
  const { t } = useTranslation(["common", "settings"]);
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
  const [language, setLanguage] = useState<AppLanguage>(currentLanguage);
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus | null>(null);
  const [isLoadingCredentials, setIsLoadingCredentials] = useState(false);
  const [isClearingCredentials, setIsClearingCredentials] = useState(false);
  const [hubConfig, setHubConfig] = useState<{
    hubId: string;
    displayName: string;
    relayUrl: string;
    p2pEnabled: boolean;
    p2pPort: number;
  } | null>(null);
  const [isSavingHub, setIsSavingHub] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");

  const tabs = [
    { id: "appearance", label: t("common:settings.appearance"), icon: Palette },
    { id: "language", label: t("common:settings.language"), icon: Languages },
    { id: "security", label: t("common:settings.security"), icon: Shield },
    { id: "privacy", label: t("common:settings.privacy"), icon: ShieldCheck },
    { id: "hub", label: t("common:settings.hub"), icon: Network },
    { id: "diagnostics", label: t("common:settings.diagnostics"), icon: Activity },
    { id: "about", label: t("common:settings.about"), icon: Info },
  ] satisfies Array<{ id: SettingsTab; label: string; icon: typeof Palette }>;

  useEffect(() => {
    if (!open) return;
    let active = true;
    void api
      .getHubConfig()
      .then((config) => {
        if (active) setHubConfig(config);
      })
      .catch(() => undefined);
    setIsLoadingCredentials(true);
    void api
      .getCredentialStatus()
      .then((status) => {
        if (active) setCredentialStatus(status);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setIsLoadingCredentials(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

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

  const saveHubConfig = async () => {
    if (!hubConfig) return;
    setIsSavingHub(true);
    try {
      const updated = await api.updateHubConfig({
        displayName: hubConfig.displayName,
        relayUrl: hubConfig.relayUrl,
        p2pEnabled: hubConfig.p2pEnabled,
        p2pPort: hubConfig.p2pPort,
      });
      setHubConfig((prev) => (prev ? { ...prev, ...updated } : prev));
    } catch {
      /* toast shown by api */
    } finally {
      setIsSavingHub(false);
    }
  };

  const handleClearCredentials = async () => {
    setIsClearingCredentials(true);
    try {
      await api.clearAllCredentials();
      setCredentialStatus((current) => (current ? { ...current, agents: [] } : current));
    } catch {
      // The API client displays the localized request error.
    } finally {
      setIsClearingCredentials(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          variant="centered"
          className="max-w-3xl max-h-[80vh] flex flex-col overflow-hidden p-0"
          aria-describedby={undefined}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
            <DialogTitle>{t("common:settings.title")}</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              aria-label={t("common:buttons.close")}
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <nav
              className="w-48 shrink-0 border-r border-[var(--border-color)] bg-[var(--bg-base)] p-3"
              aria-label={t("common:settings.title")}
              role="tablist"
              aria-orientation="vertical"
            >
              <div className="space-y-1">
                {tabs.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    id={`settings-tab-${id}`}
                    role="tab"
                    aria-selected={activeTab === id}
                    aria-controls={`settings-panel-${id}`}
                    onClick={() => setActiveTab(id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                      activeTab === id
                        ? "bg-[var(--accent-subtle)] font-medium text-[var(--accent-hover)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </nav>

            <div className="min-w-0 flex-1 overflow-y-auto px-5 py-6">
              {activeTab === "appearance" && (
                <section
                  id="settings-panel-appearance"
                  role="tabpanel"
                  aria-labelledby="settings-tab-appearance"
                >
                  <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                    {t("common:settings.appearance")}
                  </h2>
                  <label className="block rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-4">
                    <span className="mb-2 block text-sm text-[var(--text-secondary)]">
                      {t("common:settings.theme")}
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
                        <SelectItem value="dark">{t("common:settings.themeDark")}</SelectItem>
                        <SelectItem value="light">{t("common:settings.themeLight")}</SelectItem>
                        <SelectItem value="system">{t("common:settings.themeSystem")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                </section>
              )}

              {activeTab === "language" && (
                <section
                  id="settings-panel-language"
                  role="tabpanel"
                  aria-labelledby="settings-tab-language"
                >
                  <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                    {t("common:settings.language")}
                  </h2>
                  <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-4">
                    <Select
                      value={language}
                      onValueChange={(nextLanguage: AppLanguage) => {
                        setLanguage(nextLanguage);
                        track("settings_changed", { section: "language", value: nextLanguage });
                        void changeLanguage(nextLanguage);
                      }}
                    >
                      <SelectTrigger aria-label={t("common:settings.language")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="zh-CN">中文</SelectItem>
                        <SelectItem value="en">English</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </section>
              )}

              {activeTab === "security" && (
                <section
                  id="settings-panel-security"
                  role="tabpanel"
                  aria-labelledby="settings-tab-security"
                >
                  <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                    {t("common:settings.security")}
                  </h2>
                  <div className="space-y-4 rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-4">
                    {credentialStatus && (
                      <div
                        className={`flex items-start gap-2 text-sm ${credentialStatus.backend === "system-keychain" ? "text-emerald-400" : "text-amber-400"}`}
                      >
                        {credentialStatus.backend === "system-keychain" ? (
                          <CircleCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                        ) : (
                          <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                        )}
                        <span>
                          {credentialStatus.backend === "system-keychain"
                            ? t("common:settings.keychainStorage")
                            : t("common:settings.fileFallback")}
                        </span>
                      </div>
                    )}
                    <div>
                      <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">
                        {t("common:settings.storedCredentials")}
                      </p>
                      {isLoadingCredentials ? (
                        <p className="text-xs text-[var(--text-muted)]">{t("common:loading")}</p>
                      ) : credentialStatus?.agents.length ? (
                        <div className="flex flex-wrap gap-2">
                          {credentialStatus.agents.map((agent) => (
                            <span
                              key={agent.id}
                              className="rounded-full bg-[var(--bg-elevated)] px-2.5 py-1 text-xs text-[var(--text-secondary)]"
                            >
                              {agent.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--text-muted)]">
                          {t("common:settings.noStoredCredentials")}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void handleClearCredentials()}
                      disabled={isClearingCredentials || !credentialStatus?.agents.length}
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                      {isClearingCredentials
                        ? t("common:settings.clearingCredentials")
                        : t("common:settings.clearCredentials")}
                    </Button>
                  </div>
                </section>
              )}

              {activeTab === "privacy" && (
                <section id="settings-panel-privacy" role="tabpanel" aria-labelledby="settings-tab-privacy">
                  <PrivacySettings />
                </section>
              )}

              {activeTab === "hub" && (
                <section id="settings-panel-hub" role="tabpanel" aria-labelledby="settings-tab-hub">
                  <h2 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">
                    {t("common:hub.hubConfig")}
                  </h2>
                  <p className="mb-3 text-xs text-[var(--text-tertiary)]">
                    {t("common:hub.hubConfigDesc")}
                  </p>
                  <div className="space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-4 text-sm">
                    {hubConfig && (
                      <>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-[var(--text-secondary)]">
                            {t("common:hub.hubId")}
                          </span>
                          <span className="font-mono text-xs text-[var(--text-primary)]">
                            {hubConfig.hubId}
                          </span>
                        </div>
                        <label className="block">
                          <span className="mb-1 block text-xs text-[var(--text-secondary)]">
                            {t("common:hub.displayName")}
                          </span>
                          <Input
                            value={hubConfig.displayName}
                            onChange={(e) =>
                              setHubConfig({ ...hubConfig, displayName: e.target.value })
                            }
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs text-[var(--text-secondary)]">
                            {t("common:hub.relayUrl")}
                          </span>
                          <Input
                            value={hubConfig.relayUrl}
                            onChange={(e) =>
                              setHubConfig({ ...hubConfig, relayUrl: e.target.value })
                            }
                          />
                        </label>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[var(--text-secondary)]">
                            {t("common:hub.p2pEnabled")}
                          </span>
                          <Switch
                            checked={hubConfig.p2pEnabled}
                            onCheckedChange={(checked) =>
                              setHubConfig({ ...hubConfig, p2pEnabled: checked })
                            }
                          />
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-full"
                          onClick={() => void saveHubConfig()}
                          disabled={isSavingHub}
                        >
                          {isSavingHub ? t("common:buttons.saving") : t("common:buttons.save")}
                        </Button>
                      </>
                    )}
                    {!hubConfig && (
                      <p className="text-xs text-[var(--text-muted)]">
                        {t("common:hub.disconnected")}
                      </p>
                    )}
                  </div>
                </section>
              )}

              {activeTab === "diagnostics" && (
                <section
                  id="settings-panel-diagnostics"
                  role="tabpanel"
                  aria-labelledby="settings-tab-diagnostics"
                >
                  <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                    {t("common:settings.diagnostics")}
                  </h2>
                  <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-4">
                    <Button variant="secondary" onClick={() => setIsLogViewerOpen(true)}>
                      <FileText aria-hidden="true" className="h-4 w-4" />
                      {t("common:settings.viewLogs")}
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
                        : t("common:settings.checkUpdates")}
                    </Button>
                    {updateStatus && (
                      <p className="w-full text-xs text-[var(--text-secondary)]" role="status">
                        {updateStatus}
                      </p>
                    )}
                  </div>
                </section>
              )}

              {activeTab === "about" && (
                <section
                  id="settings-panel-about"
                  role="tabpanel"
                  aria-labelledby="settings-tab-about"
                >
                  <h2 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                    {t("common:settings.about")}
                  </h2>
                  <div className="space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-4 text-sm">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[var(--text-secondary)]">
                        {t("common:settings.version")}
                      </span>
                      <span className="text-[var(--text-primary)]">{APP_VERSION}</span>
                    </div>
                    <a
                      href="https://github.com/z-Zihan/agent-link/blob/main/docs/GUIDE.md"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[var(--accent-hover)] hover:underline"
                    >
                      <BookOpen aria-hidden="true" className="h-3.5 w-3.5" />
                      {t("settings:guide")}
                    </a>
                    <a
                      href={HOMEPAGE_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[var(--accent-hover)] hover:underline"
                    >
                      AgentLink
                      <ExternalLink aria-hidden="true" className="h-4 w-4" />
                    </a>
                  </div>
                </section>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <LogViewer open={isLogViewerOpen} onOpenChange={setIsLogViewerOpen} />
    </>
  );
}
