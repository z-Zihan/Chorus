import { useState } from "react";
import { ExternalLink, FileText, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { getThemePreference, setThemePreference, type ThemePreference } from "@/services/theme";
import { announceUpdate, checkForUpdates } from "@/services/updater";
import { track } from "@/utils/analytics";

const APP_VERSION = "0.1.0";
const HOMEPAGE_URL = "https://agentlink.app";

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsPanel({ open, onOpenChange }: SettingsPanelProps) {
  const { t } = useTranslation(["common", "settings"]);
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
  const [language, setLanguage] = useState<AppLanguage>(currentLanguage);
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
  const [isCheckingForUpdates, setIsCheckingForUpdates] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);

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
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent variant="drawer" aria-describedby={undefined}>
          <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
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

          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6">
            <section aria-labelledby="settings-appearance">
              <h2 id="settings-appearance" className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                {t("common:settings.appearance")}
              </h2>
              <label className="block rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-4">
                <span className="mb-2 block text-sm text-[var(--text-secondary)]">
                  {t("common:settings.theme")}
                </span>
                <Select value={theme} onValueChange={(preference: ThemePreference) => {
                  setTheme(preference);
                  setThemePreference(preference);
                  track("settings_changed", { section: "theme", value: preference });
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dark">{t("common:settings.themeDark")}</SelectItem>
                    <SelectItem value="light">{t("common:settings.themeLight")}</SelectItem>
                    <SelectItem value="system">{t("common:settings.themeSystem")}</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </section>

            <section aria-labelledby="settings-language">
              <h2 id="settings-language" className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                {t("common:settings.language")}
              </h2>
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-4">
                <Select value={language} onValueChange={(nextLanguage: AppLanguage) => {
                  setLanguage(nextLanguage);
                  track("settings_changed", { section: "language", value: nextLanguage });
                  void changeLanguage(nextLanguage);
                }}>
                  <SelectTrigger aria-label={t("common:settings.language")}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh-CN">中文</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </section>

            <section aria-labelledby="settings-diagnostics">
              <h2 id="settings-diagnostics" className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                {t("common:settings.diagnostics")}
              </h2>
              <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-4">
                <Button variant="secondary" onClick={() => setIsLogViewerOpen(true)}>
                  <FileText aria-hidden="true" className="h-4 w-4" />
                  {t("common:settings.viewLogs")}
                </Button>
                <Button variant="secondary" onClick={() => void handleCheckForUpdates()} disabled={isCheckingForUpdates}>
                  <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isCheckingForUpdates ? "animate-spin" : ""}`} />
                  {isCheckingForUpdates ? t("settings:updates.checking") : t("common:settings.checkUpdates")}
                </Button>
                {updateStatus && (
                  <p className="w-full text-xs text-[var(--text-secondary)]" role="status">{updateStatus}</p>
                )}
              </div>
            </section>

            <section aria-labelledby="settings-about">
              <h2 id="settings-about" className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
                {t("common:settings.about")}
              </h2>
              <div className="space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-4 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[var(--text-secondary)]">{t("common:settings.version")}</span>
                  <span className="text-[var(--text-primary)]">{APP_VERSION}</span>
                </div>
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
          </div>
        </DialogContent>
      </Dialog>
      <LogViewer open={isLogViewerOpen} onOpenChange={setIsLogViewerOpen} />
    </>
  );
}
