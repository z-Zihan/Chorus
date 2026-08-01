import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  checkForUpdates,
  downloadAndInstall,
  type DownloadProgress,
  type UpdateInfo,
  UPDATE_AVAILABLE_EVENT,
} from "@/services/updater";
import { useUIStore } from "@/store/uiStore";

export function UpdateBanner() {
  const { t } = useTranslation("settings");
  const addToast = useUIStore((state) => state.addToast);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  useEffect(() => {
    const handleAvailable = (event: Event) => {
      setUpdate((event as CustomEvent<UpdateInfo>).detail);
      setDismissed(false);
    };
    window.addEventListener(UPDATE_AVAILABLE_EVENT, handleAvailable);
    void checkForUpdates()
      .then((availableUpdate) => {
        if (availableUpdate) setUpdate(availableUpdate);
      })
      .catch(() => undefined);

    return () => window.removeEventListener(UPDATE_AVAILABLE_EVENT, handleAvailable);
  }, []);

  if (!update || dismissed) return null;

  const handleInstall = async () => {
    setIsInstalling(true);
    try {
      await downloadAndInstall(update, setProgress, t("updates.restartPrompt"));
      addToast(t("updates.installed"), "success");
    } catch {
      addToast(t("updates.installFailed"), "error");
      setIsInstalling(false);
    }
  };

  const percent = progress?.percent;

  return (
    <div
      role="status"
      className="relative shrink-0 border-b border-[var(--update-border)] bg-[var(--update-bg)] px-4 py-2 text-[var(--update-text)]"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
        <span className="font-medium">{t("updates.available", { version: update.version })}</span>
        {isInstalling ? (
          <span>{t("updates.downloading", { progress: percent ?? "…" })}</span>
        ) : (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void handleInstall()}>
              <Download aria-hidden="true" className="h-4 w-4" />
              {t("updates.installNow")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
              {t("updates.later")}
            </Button>
          </div>
        )}
      </div>
      {isInstalling && (
        <div
          className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-[var(--update-progress-track)]"
          role="progressbar"
          aria-label={t("updates.downloadProgress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          <div
            className={`h-full bg-[var(--accent-color)] transition-[width] ${percent === null || percent === undefined ? "w-1/3 animate-pulse" : ""}`}
            style={percent === null || percent === undefined ? undefined : { width: `${percent}%` }}
          />
        </div>
      )}
      {!isInstalling && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-[var(--bg-hover)]"
          aria-label={t("updates.later")}
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
