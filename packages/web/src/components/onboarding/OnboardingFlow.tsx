import { useEffect, useRef, useState } from "react";
import { AlertCircle, ExternalLink, Loader2, RefreshCw, Search, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOnboardingStore } from "@/store/onboardingStore";
import { useAgentStore } from "@/store/agentStore";
import { useChatStore } from "@/store/chatStore";
import { Button, buttonVariants } from "@/components/ui/button";
import { openTerminal } from "@/services/terminal";

const INSTALLATION_GUIDE_URL = "https://github.com/z-Zihan/Chorus#安装与运行";
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
  const checkStatus = useOnboardingStore((s) => s.checkStatus);
  const rescan = useOnboardingStore((s) => s.rescan);
  const selectAgent = useOnboardingStore((s) => s.selectAgent);
  const complete = useOnboardingStore((s) => s.complete);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const [showTerminalInstructions, setShowTerminalInstructions] = useState(false);

  const handleOpenTerminal = async () => {
    try {
      const result = await openTerminal();
      setShowTerminalInstructions(result === "instructions");
    } catch {
      setShowTerminalInstructions(true);
    }
  };

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  // When onboarding completes, refresh agents + conversations then dismiss
  const completedRef = useRef(false);
  useEffect(() => {
    if (status?.step === "completed" && !completedRef.current) {
      completedRef.current = true;
      void fetchAgents();
      void fetchConversations();
      const timer = setTimeout(() => void complete(), 500);
      return () => clearTimeout(timer);
    }
  }, [status?.step, fetchAgents, fetchConversations, complete]);

  if (!status || status.step === "completed") return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("common:onboarding.chooseAgent")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-base)]"
    >
      <div className="w-full max-w-md px-6">
        {status.step === "bootstrapping" && (
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--accent-color)]" />
            <p className="mt-4 text-sm text-[var(--text-secondary)]">{t("common:onboarding.bootstrapping")}</p>
          </div>
        )}

        {status.step === "scanning" && (
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--accent-color)]" />
            <p className="mt-4 text-sm text-[var(--text-secondary)]">{t("common:onboarding.scanning")}</p>
          </div>
        )}

        {status.step === "choose_agent" && (
          <div>
            <h2 className="mb-4 text-center text-lg font-semibold text-[var(--text-primary)]">
              {t("common:onboarding.chooseAgent")}
            </h2>
            <div className="space-y-2">
              {status.detections.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <Terminal className="h-5 w-5 text-[var(--text-secondary)]" />
                    <div>
                      <div className="text-sm font-medium text-[var(--text-primary)]">{d.displayName}</div>
                      {d.version && (
                        <div className="text-xs text-[var(--text-tertiary)]">v{d.version}</div>
                      )}
                    </div>
                  </div>
                  {d.status === "ready" ? (
                    <Button size="sm" onClick={() => void selectAgent(d.id)} disabled={isLoading}>
                      {t("common:onboarding.useAgent")}
                    </Button>
                  ) : (
                    <span className="text-xs text-[var(--text-tertiary)]">{t(`common:status.${d.status}`)}</span>
                  )}
                </div>
              ))}
            </div>
            <Button variant="ghost" className="mt-4 w-full" onClick={() => void rescan()} disabled={isLoading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("common:onboarding.rescan")}
            </Button>
          </div>
        )}

        {status.step === "needs_auth" && (
          <div className="text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-amber-400" />
            <h2 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
              {t("common:onboarding.needsAuth")}
            </h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              {status.detection?.displayName}: {t(
                `common:onboarding.loginInstructions.${status.detection?.descriptorId ?? "unknown"}`,
              )}
            </p>
            <Button
              variant="secondary"
              className="mt-4 w-full"
              onClick={() => void handleOpenTerminal()}
            >
              <Terminal className="mr-2 h-4 w-4" />
              {t("common:onboarding.openTerminal")}
            </Button>
            {showTerminalInstructions && (
              <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                {t("common:onboarding.openTerminalWebHint")}
              </p>
            )}
            <Button className="mt-2 w-full" onClick={() => void rescan()} disabled={isLoading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("common:onboarding.rescanAfterLogin")}
            </Button>
          </div>
        )}

        {status.step === "none_found" && (
          <div className="text-center">
            <Search className="mx-auto h-8 w-8 text-[var(--text-tertiary)]" />
            <h2 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
              {t("common:onboarding.noneFound")}
            </h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              {t("common:onboarding.noneFoundDesc")}
            </p>
            <a
              className={buttonVariants({ className: "mt-4 w-full" })}
              href={INSTALLATION_GUIDE_URL}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {t("common:onboarding.installAgent")}
            </a>
            <Button
              variant="ghost"
              className="mt-2 w-full"
              onClick={() => void rescan()}
              disabled={isLoading}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t("common:onboarding.rescan")}
            </Button>
          </div>
        )}

        {status.step === "creating_workspace" && (
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--accent-color)]" />
            <p className="mt-4 text-sm text-[var(--text-secondary)]">{t("common:onboarding.creatingWorkspace")}</p>
          </div>
        )}

        {status.step === "error" && (
          <div className="text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-red-400" />
            <h2 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
              {t("common:onboarding.error")}
            </h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              {t(`common:onboarding.errors.${onboardingErrorCode(status.code)}`)}
            </p>
            {status.recoverable && (
              <Button className="mt-4 w-full" onClick={() => void rescan()} disabled={isLoading}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("common:onboarding.rescan")}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
