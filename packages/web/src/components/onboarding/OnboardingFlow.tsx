import { useEffect, useRef, useState } from "react";
import { AlertCircle, ExternalLink, Loader2, RefreshCw, Search, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOnboardingStore } from "@/store/onboardingStore";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { openTerminal } from "@/services/terminal";

const INSTALLATION_GUIDE_URL = "https://github.com/z-Zihan/Chorus#安装与运行";
const LABEL_SEPARATOR = ":";
const VERSION_PREFIX = "v";
const KNOWN_ERROR_CODES = new Set([
  "PROBE_TIMEOUT",
  "CLI_NOT_FOUND",
  "CLI_NOT_READY",
  "ADAPTER_INIT_FAILED",
  "PROBE_FAILED",
  "PERMISSION_DENIED",
  "AUTH_REQUIRED",
  "VERSION_UNSUPPORTED",
  "CLI_SCAN_FAILED",
  "UNSUPPORTED_CLI",
  "INVALID_DETECTION",
]);

function onboardingErrorCode(code: string | undefined): string {
  return code && KNOWN_ERROR_CODES.has(code) ? code : "UNKNOWN";
}

export function OnboardingFlow() {
  const { t } = useTranslation(["common"]);
  const status = useOnboardingStore((s) => s.status);
  const isLoading = useOnboardingStore((s) => s.isLoading);
  const pendingAction = useOnboardingStore((s) => s.pendingAction);
  const loadError = useOnboardingStore((s) => s.loadError);
  const actionError = useOnboardingStore((s) => s.actionError);
  const checkStatus = useOnboardingStore((s) => s.checkStatus);
  const rescan = useOnboardingStore((s) => s.rescan);
  const selectAgent = useOnboardingStore((s) => s.selectAgent);
  const [showTerminalInstructions, setShowTerminalInstructions] = useState(false);
  const retrySetupRef = useRef<HTMLButtonElement>(null);

  const handleOpenTerminal = async () => {
    try {
      const result = await openTerminal();
      setShowTerminalInstructions(result === "instructions");
    } catch {
      setShowTerminalInstructions(true);
    }
  };

  useEffect(() => {
    if (!status) void checkStatus();
  }, [status, checkStatus]);

  useEffect(() => {
    if (
      loadError ||
      isLoading ||
      (status?.step !== "bootstrapping" && status?.step !== "scanning")
    ) {
      return;
    }
    const timer = window.setTimeout(() => void checkStatus(), 800);
    return () => window.clearTimeout(timer);
  }, [status?.step, loadError, isLoading, checkStatus]);

  useEffect(() => {
    if (loadError && !isLoading) retrySetupRef.current?.focus();
  }, [loadError, isLoading]);

  if (status?.step === "completed") return null;

  const actionMessage = actionError ? (
    <div
      role="alert"
      className="mb-4 flex gap-3 rounded-xl border border-[var(--status-error)]/40 bg-[var(--danger-subtle)] px-4 py-3 text-left text-sm leading-5 text-[var(--text-primary)]"
    >
      <AlertCircle
        aria-hidden="true"
        className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-error)]"
      />
      <span>{actionError}</span>
    </div>
  ) : null;

  return (
    <Dialog open>
      <DialogContent
        aria-label={t("common:onboarding.chooseAgent")}
        aria-describedby={undefined}
        className="inset-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 items-center justify-center overflow-y-auto rounded-none border-0 bg-[var(--bg-base)] px-4 py-8 shadow-none"
        overlayClassName="bg-[var(--bg-base)] backdrop-blur-none"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogTitle className="sr-only">{t("common:onboarding.chooseAgent")}</DialogTitle>
        <div className="w-full max-w-md">
          {loadError ? (
            <div className="text-center">
              <AlertCircle
                aria-hidden="true"
                className="mx-auto h-9 w-9 text-[var(--status-error)]"
              />
              <h2 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
                {t("common:onboarding.error")}
              </h2>
              <p role="alert" className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                {loadError}
              </p>
              <Button
                ref={retrySetupRef}
                className="mt-5 min-h-11 w-full"
                onClick={() => void checkStatus()}
                disabled={isLoading}
              >
                {pendingAction === "load" ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw aria-hidden="true" className="h-4 w-4" />
                )}
                {pendingAction === "load"
                  ? t("common:onboarding.loadingSetup")
                  : t("common:onboarding.retrySetup")}
              </Button>
            </div>
          ) : !status ? (
            <div role="status" className="text-center">
              <Loader2
                aria-hidden="true"
                className="mx-auto h-8 w-8 animate-spin text-[var(--accent-color)]"
              />
              <p className="mt-4 text-sm text-[var(--text-secondary)]">
                {t("common:onboarding.loadingSetup")}
              </p>
            </div>
          ) : status.step === "bootstrapping" ? (
            <div className="text-center">
              <Loader2
                aria-hidden="true"
                className="mx-auto h-8 w-8 animate-spin text-[var(--accent-color)]"
              />
              <p className="mt-4 text-sm text-[var(--text-secondary)]">
                {t("common:onboarding.bootstrapping")}
              </p>
            </div>
          ) : null}

          {status?.step === "scanning" && (
            <div className="text-center">
              <Loader2
                aria-hidden="true"
                className="mx-auto h-8 w-8 animate-spin text-[var(--accent-color)]"
              />
              <p className="mt-4 text-sm text-[var(--text-secondary)]">
                {t("common:onboarding.scanning")}
              </p>
            </div>
          )}

          {status?.step === "choose_agent" && (
            <div>
              <h2 className="mb-4 text-center text-lg font-semibold text-[var(--text-primary)]">
                {t("common:onboarding.chooseAgent")}
              </h2>
              {actionMessage}
              <div className="max-h-[min(52vh,28rem)] space-y-2 overflow-y-auto pr-1">
                {status.detections.map((d) => (
                  <div
                    key={d.id}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Terminal
                        aria-hidden="true"
                        className="h-5 w-5 shrink-0 text-[var(--text-secondary)]"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                          {d.displayName}
                        </div>
                        {d.version && (
                          <div className="truncate text-xs text-[var(--text-tertiary)]">
                            {VERSION_PREFIX}
                            {d.version}
                          </div>
                        )}
                      </div>
                    </div>
                    {d.status === "ready" ? (
                      <Button
                        className="min-h-11 shrink-0 sm:min-h-8"
                        size="sm"
                        onClick={() => void selectAgent(d.id)}
                        disabled={isLoading}
                      >
                        {pendingAction === "select" && (
                          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                        )}
                        {pendingAction === "select"
                          ? t("common:onboarding.startingAgent")
                          : t("common:onboarding.useAgent")}
                      </Button>
                    ) : (
                      <span className="text-xs text-[var(--text-tertiary)]">
                        {t(`common:status.${d.status}`)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <Button
                variant="ghost"
                className="mt-4 min-h-11 w-full"
                onClick={() => void rescan()}
                disabled={isLoading}
              >
                {pendingAction === "rescan" ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw aria-hidden="true" className="h-4 w-4" />
                )}
                {pendingAction === "rescan"
                  ? t("common:onboarding.rescanning")
                  : t("common:onboarding.rescan")}
              </Button>
            </div>
          )}

          {status?.step === "needs_auth" && (
            <div className="text-center">
              <AlertCircle
                aria-hidden="true"
                className="mx-auto h-8 w-8 text-[var(--status-busy)]"
              />
              <h2 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
                {t("common:onboarding.needsAuth")}
              </h2>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {status.detection?.displayName}
                {LABEL_SEPARATOR}{" "}
                {t(
                  `common:onboarding.loginInstructions.${status.detection?.descriptorId ?? "unknown"}`,
                )}
              </p>
              {actionMessage}
              <Button
                variant="secondary"
                className="mt-4 min-h-11 w-full"
                onClick={() => void handleOpenTerminal()}
              >
                <Terminal aria-hidden="true" className="h-4 w-4" />
                {t("common:onboarding.openTerminal")}
              </Button>
              {showTerminalInstructions && (
                <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                  {t("common:onboarding.openTerminalWebHint")}
                </p>
              )}
              <Button
                className="mt-2 min-h-11 w-full"
                onClick={() => void rescan()}
                disabled={isLoading}
              >
                {pendingAction === "rescan" ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw aria-hidden="true" className="h-4 w-4" />
                )}
                {pendingAction === "rescan"
                  ? t("common:onboarding.rescanning")
                  : t("common:onboarding.rescanAfterLogin")}
              </Button>
            </div>
          )}

          {status?.step === "none_found" && (
            <div className="text-center">
              <Search aria-hidden="true" className="mx-auto h-8 w-8 text-[var(--text-tertiary)]" />
              <h2 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
                {t("common:onboarding.noneFound")}
              </h2>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {t("common:onboarding.noneFoundDesc")}
              </p>
              {actionMessage}
              <a
                className={buttonVariants({ className: "mt-4 min-h-11 w-full" })}
                href={INSTALLATION_GUIDE_URL}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink aria-hidden="true" className="h-4 w-4" />
                {t("common:onboarding.installAgent")}
              </a>
              <Button
                variant="ghost"
                className="mt-2 min-h-11 w-full"
                onClick={() => void rescan()}
                disabled={isLoading}
              >
                {pendingAction === "rescan" ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw aria-hidden="true" className="h-4 w-4" />
                )}
                {pendingAction === "rescan"
                  ? t("common:onboarding.rescanning")
                  : t("common:onboarding.rescan")}
              </Button>
            </div>
          )}

          {status?.step === "creating_workspace" && (
            <div className="text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--accent-color)]" />
              <p className="mt-4 text-sm text-[var(--text-secondary)]">
                {t("common:onboarding.creatingWorkspace")}
              </p>
            </div>
          )}

          {status?.step === "error" && (
            <div className="text-center">
              <AlertCircle
                aria-hidden="true"
                className="mx-auto h-8 w-8 text-[var(--status-error)]"
              />
              <h2 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
                {t("common:onboarding.error")}
              </h2>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {t(`common:onboarding.errors.${onboardingErrorCode(status.code)}`)}
              </p>
              {status.recoverable && (
                <Button
                  className="mt-4 min-h-11 w-full"
                  onClick={() => void rescan()}
                  disabled={isLoading}
                >
                  {pendingAction === "rescan" ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw aria-hidden="true" className="h-4 w-4" />
                  )}
                  {pendingAction === "rescan"
                    ? t("common:onboarding.rescanning")
                    : t("common:onboarding.rescan")}
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
