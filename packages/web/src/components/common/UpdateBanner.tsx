import { useEffect, useState } from "react";
import { Download, RotateCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  checkForUpdates,
  downloadAndInstall,
  isUpdateSupported,
  relaunchApp,
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
  const [isInstalled, setIsInstalled] = useState(false);
  const [isRestartPromptOpen, setIsRestartPromptOpen] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  useEffect(() => {
    const handleAvailable = (event: Event) => {
      setUpdate((event as CustomEvent<UpdateInfo>).detail);
      setDismissed(false);
      setIsInstalling(false);
      setIsInstalled(false);
      setIsRestartPromptOpen(false);
      setIsRestarting(false);
      setProgress(null);
    };
    window.addEventListener(UPDATE_AVAILABLE_EVENT, handleAvailable);
    if (isUpdateSupported()) {
      void checkForUpdates()
        .then((availableUpdate) => {
          if (availableUpdate) setUpdate(availableUpdate);
        })
        .catch(() => addToast(t("updates.backgroundCheckFailed"), "error"));
    }

    return () => window.removeEventListener(UPDATE_AVAILABLE_EVENT, handleAvailable);
  }, [addToast, t]);

  if (!update || dismissed) return null;

  const handleInstall = async () => {
    setIsInstalling(true);
    setProgress(null);
    try {
      await downloadAndInstall(update, setProgress);
      setIsInstalling(false);
      setIsInstalled(true);
      setIsRestartPromptOpen(true);
      addToast(t("updates.installed"), "success");
    } catch {
      addToast(t("updates.installFailed"), "error");
      setIsInstalling(false);
      setProgress(null);
    }
  };

  const handleRestart = async () => {
    setIsRestarting(true);
    try {
      await relaunchApp();
    } catch {
      setIsRestarting(false);
      addToast(t("updates.restartFailed"), "error");
    }
  };

  const percent = progress?.percent;

  return (
    <>
      <div
        role="status"
        className="relative shrink-0 border-b border-[var(--update-border)] bg-[var(--update-bg)] px-12 py-2 text-[var(--update-text)]"
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center text-sm">
          <span className="font-medium">
            {isInstalled
              ? t("updates.readyToRestart")
              : t("updates.available", { version: update.version })}
          </span>
          {isInstalling ? (
            <span>{t("updates.downloading", { progress: percent ?? "…" })}</span>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                className="min-h-11 sm:min-h-8"
                size="sm"
                onClick={() => (isInstalled ? setIsRestartPromptOpen(true) : void handleInstall())}
              >
                {isInstalled ? (
                  <RotateCw aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Download aria-hidden="true" className="h-4 w-4" />
                )}
                {isInstalled ? t("updates.restartNow") : t("updates.installNow")}
              </Button>
              <Button
                className="min-h-11 sm:min-h-8"
                size="sm"
                variant="ghost"
                onClick={() => setDismissed(true)}
              >
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
              style={
                percent === null || percent === undefined ? undefined : { width: `${percent}%` }
              }
            />
          </div>
        )}
        {!isInstalling && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg hover:bg-[var(--bg-hover)]"
            aria-label={t("updates.later")}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>
      <ConfirmDialog
        open={isRestartPromptOpen}
        title={t("updates.restartTitle")}
        message={t("updates.restartPrompt")}
        confirmLabel={t("updates.restartNow")}
        confirmingLabel={t("updates.restarting")}
        cancelLabel={t("updates.later")}
        confirmVariant="primary"
        isConfirming={isRestarting}
        onConfirm={() => void handleRestart()}
        onCancel={() => setIsRestartPromptOpen(false)}
      />
    </>
  );
}
