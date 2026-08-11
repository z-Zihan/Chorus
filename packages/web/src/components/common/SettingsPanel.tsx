import { useUIStore } from "@/store/uiStore";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Activity,
  BookOpen,
  CalendarClock,
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
import { PluginDiagnostics } from "@/components/settings/PluginDiagnostics";
import { ScheduledTasksSettings } from "@/components/settings/ScheduledTasksSettings";
import { LogViewer } from "@/components/common/LogViewer";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
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
import {
  announceUpdate,
  checkForUpdates,
  isUpdateConfigured,
  isUpdateSupported,
} from "@/services/updater";
import { track } from "@/utils/analytics";

const APP_VERSION = "0.1.0";
const HOMEPAGE_URL = "https://github.com/z-Zihan/Chorus";

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsTab =
  | "appearance"
  | "language"
  | "security"
  | "privacy"
  | "hub"
  | "scheduler"
  | "diagnostics"
  | "about";

export function SettingsPanel({ open, onOpenChange }: SettingsPanelProps) {
  const { t } = useTranslation(["common", "settings"]);
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
  const [language, setLanguage] = useState<AppLanguage>(currentLanguage);
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const updateConfigured = isUpdateConfigured();
  const updateSupported = isUpdateSupported();
  const [credentialStatus, setCredentialStatus] = useState<CredentialStatus | null>(null);
  const [isLoadingCredentials, setIsLoadingCredentials] = useState(false);
  const [credentialsError, setCredentialsError] = useState(false);
  const [isClearingCredentials, setIsClearingCredentials] = useState(false);
  const [isClearCredentialsOpen, setIsClearCredentialsOpen] = useState(false);
  const [clearCredentialsError, setClearCredentialsError] = useState<string | null>(null);
  const [hubConfig, setHubConfig] = useState<{
    hubId: string;
    displayName: string;
    relayUrl: string;
    p2pEnabled: boolean;
    p2pPort: number;
  } | null>(null);
  const [isLoadingHub, setIsLoadingHub] = useState(false);
  const [hubConfigError, setHubConfigError] = useState(false);
  const [isSavingHub, setIsSavingHub] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("appearance");
  const [isVerticalTabs, setIsVerticalTabs] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 640px)").matches : false,
  );
  const tabRefs = useRef(new Map<SettingsTab, HTMLButtonElement>());
  const addToast = useUIStore((state) => state.addToast);

  const tabs = [
    { id: "appearance", label: t("common:settings.appearance"), icon: Palette },
    { id: "language", label: t("common:settings.language"), icon: Languages },
    { id: "security", label: t("common:settings.security"), icon: Shield },
    { id: "privacy", label: t("common:settings.privacy"), icon: ShieldCheck },
    { id: "hub", label: t("common:settings.hub"), icon: Network },
    { id: "scheduler", label: t("common:scheduler.title"), icon: CalendarClock },
    { id: "diagnostics", label: t("common:settings.diagnostics"), icon: Activity },
    { id: "about", label: t("common:settings.about"), icon: Info },
  ] satisfies Array<{ id: SettingsTab; label: string; icon: typeof Palette }>;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 640px)");
    const updateOrientation = () => setIsVerticalTabs(mediaQuery.matches);
    updateOrientation();
    mediaQuery.addEventListener("change", updateOrientation);
    return () => mediaQuery.removeEventListener("change", updateOrientation);
  }, []);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentId: SettingsTab) => {
    const currentIndex = tabs.findIndex(({ id }) => id === currentId);
    let nextIndex: number | null = null;

    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    const nextId = tabs[nextIndex].id;
    setActiveTab(nextId);
    const nextTab = tabRefs.current.get(nextId);
    nextTab?.focus();
    nextTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const loadHubConfig = useCallback(async () => {
    setIsLoadingHub(true);
    setHubConfigError(false);
    try {
      setHubConfig(await api.getHubConfig());
    } catch {
      setHubConfigError(true);
    } finally {
      setIsLoadingHub(false);
    }
  }, []);

  const loadCredentialStatus = useCallback(async () => {
    setIsLoadingCredentials(true);
    setCredentialsError(false);
    try {
      setCredentialStatus(await api.getCredentialStatus(true));
    } catch {
      setCredentialsError(true);
    } finally {
      setIsLoadingCredentials(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadHubConfig();
    void loadCredentialStatus();
  }, [loadCredentialStatus, loadHubConfig, open]);

  const handleCheckForUpdates = async () => {
    if (!updateSupported) {
      setUpdateStatus(
        t(
          updateConfigured
            ? "settings:updates.notAvailableInWeb"
            : "settings:updates.notConfigured",
        ),
      );
      return;
    }
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
      const updated = await api.updateHubConfig(
        {
          displayName: hubConfig.displayName,
          relayUrl: hubConfig.relayUrl,
          p2pEnabled: hubConfig.p2pEnabled,
          p2pPort: hubConfig.p2pPort,
        },
        true,
      );
      setHubConfig((prev) => (prev ? { ...prev, ...updated } : prev));
      addToast(t("settings:hubSaved"), "success");
      // Refresh hub status to show connection state immediately
      try {
        const status = await api.getHubStatus();
        if (status.relayState === "connected") {
          addToast(t("common:hub.connected"), "info");
        } else if (status.relayState === "connecting" || status.relayState === "reconnecting") {
          addToast(t("settings:hubConnecting"), "info");
        }
      } catch {
        // Status refresh is best-effort
      }
    } catch {
      addToast(t("settings:hubSaveFailed"), "error");
    } finally {
      setIsSavingHub(false);
    }
  };

  const handleClearCredentials = async () => {
    setIsClearingCredentials(true);
    setClearCredentialsError(null);
    try {
      await api.clearAllCredentials(true);
      setCredentialStatus((current) => (current ? { ...current, agents: [] } : current));
      setIsClearCredentialsOpen(false);
      addToast(t("settings:credentialsCleared"), "success");
    } catch {
      setClearCredentialsError(t("settings:credentialsClearFailed"));
    } finally {
      setIsClearingCredentials(false);
    }
  };

  const handleThemeChange = (preference: ThemePreference) => {
    setTheme(preference);
    if (!setThemePreference(preference)) {
      addToast(t("settings:preferenceSaveFailed"), "error");
    }
    track("settings_changed", { section: "theme", value: preference });
  };

  const handleLanguageChange = async (nextLanguage: AppLanguage) => {
    setLanguage(nextLanguage);
    track("settings_changed", { section: "language", value: nextLanguage });
    if (!(await changeLanguage(nextLanguage))) {
      addToast(t("settings:preferenceSaveFailed"), "error");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          variant="centered"
          className="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-3xl flex-col overflow-hidden p-0 sm:max-h-[80vh]"
          aria-describedby={undefined}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
            <DialogTitle>{t("common:settings.title")}</DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 sm:h-9 sm:w-9"
              onClick={() => onOpenChange(false)}
              aria-label={t("common:buttons.close")}
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
            <nav
              className="w-full shrink-0 overflow-x-auto border-b border-[var(--border-color)] bg-[var(--bg-base)] p-2 sm:w-48 sm:overflow-x-hidden sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-3"
              aria-label={t("common:settings.title")}
              role="tablist"
              aria-orientation={isVerticalTabs ? "vertical" : "horizontal"}
            >
              <div className="flex gap-1 sm:block sm:space-y-1">
                {tabs.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    id={`settings-tab-${id}`}
                    role="tab"
                    aria-selected={activeTab === id}
                    aria-controls={`settings-panel-${id}`}
                    tabIndex={activeTab === id ? 0 : -1}
                    ref={(element) => {
                      if (element) tabRefs.current.set(id, element);
                      else tabRefs.current.delete(id);
                    }}
                    onClick={() => setActiveTab(id)}
                    onKeyDown={(event) => handleTabKeyDown(event, id)}
                    className={`flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 py-3 text-left text-sm transition-colors sm:w-full sm:gap-3 sm:py-2.5 ${
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

            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5 sm:py-6">
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
                    <Select value={theme} onValueChange={handleThemeChange}>
                      <SelectTrigger className="min-h-11 sm:min-h-10">
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
                      onValueChange={(nextLanguage: AppLanguage) =>
                        void handleLanguageChange(nextLanguage)
                      }
                    >
                      <SelectTrigger
                        className="min-h-11 sm:min-h-10"
                        aria-label={t("common:settings.language")}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="zh-CN">{t("settings:languageOptions.zh-CN")}</SelectItem>
                        <SelectItem value="en">{t("settings:languageOptions.en")}</SelectItem>
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
                    {credentialsError && (
                      <div
                        role="alert"
                        className="rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-3"
                      >
                        <p className="text-xs leading-5 text-[var(--text-secondary)]">
                          {t("settings:credentialsLoadFailed")}
                        </p>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-2 min-h-11 sm:min-h-8"
                          onClick={() => void loadCredentialStatus()}
                        >
                          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                          {t("common:buttons.retry")}
                        </Button>
                      </div>
                    )}
                    {credentialStatus && (
                      <div
                        className={`flex items-start gap-2 text-sm ${credentialStatus.backend === "system-keychain" ? "text-[var(--status-online)]" : "text-[var(--status-busy)]"}`}
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
                      ) : !credentialsError && credentialStatus?.agents.length ? (
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
                      ) : !credentialsError ? (
                        <p className="text-xs text-[var(--text-muted)]">
                          {t("common:settings.noStoredCredentials")}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      className="min-h-11 sm:min-h-8"
                      onClick={() => {
                        setClearCredentialsError(null);
                        setIsClearCredentialsOpen(true);
                      }}
                      disabled={
                        isClearingCredentials ||
                        credentialsError ||
                        !credentialStatus?.agents.length
                      }
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
                <section
                  id="settings-panel-privacy"
                  role="tabpanel"
                  aria-labelledby="settings-tab-privacy"
                >
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
                    {hubConfigError && (
                      <div
                        role="alert"
                        className="rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-3"
                      >
                        <p className="text-xs leading-5 text-[var(--text-secondary)]">
                          {t("settings:hubConfigLoadFailed")}
                        </p>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-2 min-h-11 sm:min-h-8"
                          onClick={() => void loadHubConfig()}
                        >
                          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                          {t("common:buttons.retry")}
                        </Button>
                      </div>
                    )}
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
                            className="min-h-11 sm:min-h-10"
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
                            className="min-h-11 sm:min-h-10"
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
                            aria-label={t("common:hub.p2pEnabled")}
                            checked={hubConfig.p2pEnabled}
                            onCheckedChange={(checked) =>
                              setHubConfig({ ...hubConfig, p2pEnabled: checked })
                            }
                            className="relative h-11 w-11 border-0 bg-transparent before:absolute before:inset-x-0 before:top-2.5 before:h-6 before:rounded-full before:bg-[var(--bg-active)] data-[state=checked]:bg-transparent data-[state=checked]:before:bg-[var(--accent-color)] sm:h-6 sm:bg-[var(--bg-active)] sm:before:hidden sm:data-[state=checked]:bg-[var(--accent-color)]"
                          />
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="min-h-11 w-full sm:min-h-8"
                          onClick={() => void saveHubConfig()}
                          disabled={isSavingHub}
                        >
                          {isSavingHub ? t("common:buttons.saving") : t("common:buttons.save")}
                        </Button>
                      </>
                    )}
                    {isLoadingHub && !hubConfig && (
                      <p role="status" className="text-xs text-[var(--text-muted)]">
                        {t("common:loading")}
                      </p>
                    )}
                    {!isLoadingHub && !hubConfigError && !hubConfig && (
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
                    <Button
                      className="min-h-11 sm:min-h-10"
                      variant="secondary"
                      onClick={() => setIsLogViewerOpen(true)}
                    >
                      <FileText aria-hidden="true" className="h-4 w-4" />
                      {t("common:settings.viewLogs")}
                    </Button>
                    <Button
                      className="min-h-11 sm:min-h-10"
                      variant="secondary"
                      onClick={() => void handleCheckForUpdates()}
                      disabled={isCheckingForUpdates || !updateSupported}
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
                    {!updateConfigured && (
                      <p className="w-full text-xs text-[var(--text-secondary)]" role="status">
                        {t("settings:updates.notConfigured")}
                      </p>
                    )}
                    {updateConfigured && !updateSupported && (
                      <p className="w-full text-xs text-[var(--text-secondary)]" role="status">
                        {t("settings:updates.notAvailableInWeb")}
                      </p>
                    )}
                  </div>
                  <PluginDiagnostics />
                </section>
              )}

              {activeTab === "scheduler" && (
                <section
                  id="settings-panel-scheduler"
                  role="tabpanel"
                  aria-labelledby="settings-tab-scheduler"
                >
                  <ScheduledTasksSettings />
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
                      href="https://github.com/z-Zihan/Chorus/blob/main/docs/GUIDE.md"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1.5 text-[var(--accent-hover)] hover:underline"
                    >
                      <BookOpen aria-hidden="true" className="h-3.5 w-3.5" />
                      {t("settings:guide")}
                    </a>
                    <a
                      href={HOMEPAGE_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center gap-1.5 text-[var(--accent-hover)] hover:underline"
                    >
                      {t("common:appName")}
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
      <ConfirmDialog
        open={isClearCredentialsOpen}
        title={t("settings:clearCredentialsTitle")}
        message={
          <div>
            <p>{t("settings:clearCredentialsMessage")}</p>
            {clearCredentialsError && (
              <p role="alert" className="mt-3 text-[var(--status-error)]">
                {clearCredentialsError}
              </p>
            )}
          </div>
        }
        confirmLabel={t("common:settings.clearCredentials")}
        confirmingLabel={t("common:settings.clearingCredentials")}
        isConfirming={isClearingCredentials}
        onConfirm={() => void handleClearCredentials()}
        onCancel={() => {
          setIsClearCredentialsOpen(false);
          setClearCredentialsError(null);
        }}
      />
    </>
  );
}
