import { useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LogViewer } from "@/components/common/LogViewer";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { changeLanguage, currentLanguage, type AppLanguage } from "@/i18n";
import { getThemePreference, setThemePreference, type ThemePreference } from "@/services/theme";
import {
  announceUpdate,
  checkForUpdates,
  getUpdateChannel,
  isUpdateConfigured,
  isUpdateSupported,
  setUpdateChannel,
  type UpdateChannel,
} from "@/services/updater";
import { useUIStore } from "@/store/uiStore";

export function AgentSettingsExtras() {
  const { t } = useTranslation("settings");
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
  const [updateChannel, setChannel] = useState<UpdateChannel>(getUpdateChannel);
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const updateConfigured = isUpdateConfigured();
  const updateSupported = isUpdateSupported();
  const addToast = useUIStore((state) => state.addToast);

  const handleThemeChange = (preference: ThemePreference) => {
    setTheme(preference);
    if (!setThemePreference(preference)) addToast(t("preferenceSaveFailed"), "error");
  };

  const handleLanguageChange = async (language: AppLanguage) => {
    if (!(await changeLanguage(language))) addToast(t("preferenceSaveFailed"), "error");
  };

  const handleCheckForUpdates = async () => {
    if (!updateSupported) {
      setUpdateStatus(t(updateConfigured ? "updates.notAvailableInWeb" : "updates.notConfigured"));
      return;
    }
    setIsCheckingForUpdates(true);
    setUpdateStatus(null);
    try {
      const update = await checkForUpdates();
      if (update) {
        announceUpdate(update);
        setUpdateStatus(t("updates.available", { version: update.version }));
      } else {
        setUpdateStatus(t("updates.upToDate"));
      }
    } catch {
      setUpdateStatus(t("updates.checkFailed"));
    } finally {
      setIsCheckingForUpdates(false);
    }
  };

  return (
    <>
      <fieldset className="space-y-4 rounded-xl border border-[var(--border-color)] p-4">
        <legend className="px-1 text-sm font-semibold text-[var(--text-primary)]">
          {t("preferences")}
        </legend>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
            {t("theme")}
          </span>
          <Select value={theme} onValueChange={handleThemeChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">{t("themeOptions.dark")}</SelectItem>
              <SelectItem value="light">{t("themeOptions.light")}</SelectItem>
              <SelectItem value="system">{t("themeOptions.system")}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
            {t("language")}
          </span>
          <Select
            value={currentLanguage()}
            onValueChange={(language: AppLanguage) => void handleLanguageChange(language)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="zh-CN">{t("languageOptions.zh-CN")}</SelectItem>
              <SelectItem value="en">{t("languageOptions.en")}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
            {t("updates.channel")}
          </span>
          <Select
            disabled={!updateSupported}
            value={updateChannel}
            onValueChange={(channel: UpdateChannel) => {
              if (setUpdateChannel(channel)) {
                setChannel(channel);
                setUpdateStatus(null);
              } else {
                setUpdateStatus(t("updates.channelSaveFailed"));
              }
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stable">{t("updates.channels.stable")}</SelectItem>
              <SelectItem value="beta">{t("updates.channels.beta")}</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </fieldset>

      <fieldset className="rounded-xl border border-[var(--border-color)] p-4">
        <legend className="px-1 text-sm font-semibold text-[var(--text-primary)]">
          {t("diagnostics")}
        </legend>
        <p className="mb-3 text-xs leading-5 text-[var(--text-muted)]">{t("logs.description")}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setIsLogViewerOpen(true)}>
            <FileText aria-hidden="true" className="h-4 w-4" />
            {t("logs.view")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void handleCheckForUpdates()}
            disabled={isCheckingForUpdates || !updateSupported}
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-4 w-4 ${isCheckingForUpdates ? "animate-spin" : ""}`}
            />
            {isCheckingForUpdates ? t("updates.checking") : t("updates.check")}
          </Button>
        </div>
        {updateStatus && (
          <p className="mt-3 text-xs text-[var(--text-secondary)]" role="status">
            {updateStatus}
          </p>
        )}
        {!updateConfigured && (
          <p className="mt-3 text-xs text-[var(--text-secondary)]" role="status">
            {t("updates.notConfigured")}
          </p>
        )}
        {updateConfigured && !updateSupported && (
          <p className="mt-3 text-xs text-[var(--text-secondary)]" role="status">
            {t("updates.notAvailableInWeb")}
          </p>
        )}
      </fieldset>
      <LogViewer open={isLogViewerOpen} onOpenChange={setIsLogViewerOpen} />
    </>
  );
}
