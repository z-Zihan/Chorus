import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Ban,
  Eye,
  Gauge,
  LoaderCircle,
  RefreshCw,
  Shield,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { api, type A2AMode } from "@/services/api";
import { useAgentStore } from "@/store/agentStore";
import { useChatStore } from "@/store/chatStore";
import { useUIStore } from "@/store/uiStore";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { logger } from "@/utils/logger";

interface TrustedHub {
  hubId: string;
  hubFingerprint: string;
  userName?: string;
  trustLevel: string;
  lastSeenAt?: number;
  pairedAt?: number;
}

interface TrustAction {
  action: "block" | "remove";
  hub: TrustedHub;
}

export function PrivacySettings() {
  const { t } = useTranslation(["common", "settings"]);
  const agents = useAgentStore((state) => state.agents);
  const agentsLoadError = useAgentStore((state) => state.loadError);
  const fetchAgents = useAgentStore((state) => state.fetchAgents);
  const dmConversations = useChatStore((state) => state.conversations);
  const groupConversations = useChatStore((state) => state.groupConversations);
  const conversationsError = useChatStore((state) => state.conversationsError);
  const fetchConversations = useChatStore((state) => state.fetchConversations);
  const addToast = useUIStore((state) => state.addToast);
  const conversations = useMemo(
    () => [...dmConversations, ...groupConversations],
    [dmConversations, groupConversations],
  );
  const [trustList, setTrustList] = useState<TrustedHub[]>([]);
  const [a2aModes, setA2aModes] = useState<Record<string, A2AMode>>({});
  const [maxRounds, setMaxRounds] = useState<number | null>(null);
  const [maxRoundsDraft, setMaxRoundsDraft] = useState("12");
  const [callTimeoutMinutes, setCallTimeoutMinutes] = useState<number | null>(null);
  const [callTimeoutDraft, setCallTimeoutDraft] = useState("5");
  const [isLoading, setIsLoading] = useState(true);
  const [trustLoadFailed, setTrustLoadFailed] = useState(false);
  const [modesLoadFailed, setModesLoadFailed] = useState(false);
  const [roundsLoadFailed, setRoundsLoadFailed] = useState(false);
  const [isRoundsSaving, setIsRoundsSaving] = useState(false);
  const [roundsError, setRoundsError] = useState<string | null>(null);
  const [callTimeoutError, setCallTimeoutError] = useState<string | null>(null);
  const [collaborationSettingsError, setCollaborationSettingsError] = useState<string | null>(null);
  const [pendingConversationId, setPendingConversationId] = useState<string | null>(null);
  const [trustAction, setTrustAction] = useState<TrustAction | null>(null);
  const [isTrustActionPending, setIsTrustActionPending] = useState(false);

  const loadPrivacySettings = useCallback(async () => {
    setIsLoading(true);
    setTrustLoadFailed(false);
    setModesLoadFailed(false);
    setRoundsLoadFailed(false);
    const modeConversations = conversations.slice(0, 20);
    const [trustResult, roundsResult, ...modeResults] = await Promise.allSettled([
      api.getTrustList(true),
      api.getA2ACollaborationSettings(true),
      ...modeConversations.map((conversation) => api.getA2AMode(conversation.id, true)),
    ]);

    if (trustResult.status === "fulfilled") {
      setTrustList(trustResult.value);
    } else {
      logger.error("Failed to load trusted Hubs", trustResult.reason);
      setTrustLoadFailed(true);
    }

    if (roundsResult.status === "fulfilled") {
      setMaxRounds(roundsResult.value.maxRounds);
      setMaxRoundsDraft(String(roundsResult.value.maxRounds));
      setCallTimeoutMinutes(roundsResult.value.callTimeoutMinutes);
      setCallTimeoutDraft(String(roundsResult.value.callTimeoutMinutes));
      setRoundsError(null);
      setCallTimeoutError(null);
      setCollaborationSettingsError(null);
    } else {
      logger.error("Failed to load A2A collaboration settings", roundsResult.reason);
      setRoundsLoadFailed(true);
    }

    const loadedModes: Record<string, A2AMode> = {};
    let anyModeFailed = false;
    modeConversations.forEach((conversation, index) => {
      const result = modeResults[index];
      if (result?.status === "fulfilled") loadedModes[conversation.id] = result.value.mode;
      else anyModeFailed = true;
    });
    setA2aModes((current) => ({ ...current, ...loadedModes }));
    setModesLoadFailed(anyModeFailed);
    setIsLoading(false);
  }, [conversations]);

  useEffect(() => {
    void loadPrivacySettings();
  }, [loadPrivacySettings]);

  const handleA2AModeChange = async (conversationId: string, mode: A2AMode) => {
    const previousMode = a2aModes[conversationId];
    if (!previousMode) return;
    setPendingConversationId(conversationId);
    setA2aModes((current) => ({ ...current, [conversationId]: mode }));
    try {
      await api.setA2AMode(conversationId, mode, true);
    } catch (error) {
      logger.error("Failed to set A2A mode", error);
      setA2aModes((current) => ({ ...current, [conversationId]: previousMode }));
      addToast(t("settings:a2aModeUpdateFailed"), "error");
    } finally {
      setPendingConversationId(null);
    }
  };

  const handleMaxRoundsSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const maxRoundsValue = Number(maxRoundsDraft);
    const callTimeoutValue = Number(callTimeoutDraft);
    const maxRoundsValid =
      Number.isInteger(maxRoundsValue) && maxRoundsValue >= 1 && maxRoundsValue <= 50;
    const callTimeoutValid =
      Number.isInteger(callTimeoutValue) && callTimeoutValue >= 1 && callTimeoutValue <= 30;
    setRoundsError(maxRoundsValid ? null : t("settings:a2aMaxRoundsInvalid"));
    setCallTimeoutError(callTimeoutValid ? null : t("settings:a2aCallTimeoutMinutesInvalid"));
    if (!maxRoundsValid || !callTimeoutValid) {
      return;
    }
    setIsRoundsSaving(true);
    setRoundsError(null);
    setCallTimeoutError(null);
    setCollaborationSettingsError(null);
    try {
      const saved = await api.setA2ACollaborationSettings(
        {
          maxRounds: maxRoundsValue,
          callTimeoutMinutes: callTimeoutValue,
        },
        true,
      );
      setMaxRounds(saved.maxRounds);
      setMaxRoundsDraft(String(saved.maxRounds));
      setCallTimeoutMinutes(saved.callTimeoutMinutes);
      setCallTimeoutDraft(String(saved.callTimeoutMinutes));
      setRoundsLoadFailed(false);
      addToast(t("settings:a2aCollaborationSettingsSaved"), "success");
    } catch (error) {
      logger.error("Failed to save A2A collaboration settings", error);
      setCollaborationSettingsError(t("settings:a2aCollaborationSettingsSaveFailed"));
    } finally {
      setIsRoundsSaving(false);
    }
  };

  const confirmTrustAction = async () => {
    if (!trustAction) return;
    setIsTrustActionPending(true);
    try {
      if (trustAction.action === "block") {
        await api.blockHub(trustAction.hub.hubId, true);
        addToast(t("settings:hubBlocked"), "success");
      } else {
        await api.removeTrust(trustAction.hub.hubId, true);
        addToast(t("settings:trustRemoved"), "success");
      }
      setTrustList((current) => current.filter((hub) => hub.hubId !== trustAction.hub.hubId));
      setTrustAction(null);
    } catch (error) {
      logger.error("Failed to update Hub trust", error);
      addToast(
        t(
          trustAction.action === "block" ? "settings:blockHubFailed" : "settings:removeTrustFailed",
        ),
        "error",
      );
    } finally {
      setIsTrustActionPending(false);
    }
  };

  const localAgents = agents.filter((agent) => agent.ownerType !== "remote");

  if (
    isLoading &&
    trustList.length === 0 &&
    Object.keys(a2aModes).length === 0 &&
    maxRounds === null &&
    callTimeoutMinutes === null
  ) {
    return (
      <div role="status" className="flex items-center gap-2 p-4 text-sm text-[var(--text-muted)]">
        <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
        {t("common:loading")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <Shield aria-hidden="true" className="h-4 w-4" />
          {t("settings:a2aMode")}
        </h3>
        <p className="mb-3 text-xs text-[var(--text-tertiary)]">{t("settings:a2aModeDesc")}</p>
        <form
          noValidate
          onSubmit={(event) => void handleMaxRoundsSubmit(event)}
          className="mb-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] p-3"
        >
          <div className="flex items-start gap-2">
            <Gauge
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-hover)]"
            />
            <div className="min-w-0 flex-1">
              <label
                htmlFor="a2a-max-rounds"
                className="text-sm font-medium text-[var(--text-primary)]"
              >
                {t("settings:a2aMaxRounds")}
              </label>
              <p className="mt-0.5 text-xs leading-5 text-[var(--text-tertiary)]">
                {t("settings:a2aMaxRoundsDesc")}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id="a2a-max-rounds"
              type="number"
              min={1}
              max={50}
              step={1}
              inputMode="numeric"
              value={maxRoundsDraft}
              onChange={(event) => {
                setMaxRoundsDraft(event.target.value);
                setRoundsError(null);
                setCollaborationSettingsError(null);
              }}
              disabled={isRoundsSaving || roundsLoadFailed}
              aria-invalid={roundsError ? true : undefined}
              aria-describedby="a2a-max-rounds-help a2a-max-rounds-error a2a-collaboration-settings-error"
              className="min-h-11 w-full rounded border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--focus-ring)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]/35 disabled:opacity-50 sm:min-h-9 sm:w-24"
            />
          </div>
          <p id="a2a-max-rounds-help" className="mt-2 text-xs text-[var(--text-muted)]">
            {t("settings:a2aMaxRoundsHelp")}
          </p>
          {roundsError && (
            <p
              id="a2a-max-rounds-error"
              role="alert"
              className="mt-2 text-xs text-[var(--status-error)]"
            >
              {roundsError}
            </p>
          )}

          <div className="mt-4 border-t border-[var(--border-color)] pt-4">
            <label
              htmlFor="a2a-call-timeout"
              className="text-sm font-medium text-[var(--text-primary)]"
            >
              {t("settings:a2aCallTimeoutMinutes")}
            </label>
            <p className="mt-0.5 text-xs leading-5 text-[var(--text-tertiary)]">
              {t("settings:a2aCallTimeoutMinutesDesc")}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <input
                id="a2a-call-timeout"
                type="number"
                min={1}
                max={30}
                step={1}
                inputMode="numeric"
                value={callTimeoutDraft}
                onChange={(event) => {
                  setCallTimeoutDraft(event.target.value);
                  setCallTimeoutError(null);
                  setRoundsError(null);
                  setCollaborationSettingsError(null);
                }}
                disabled={isRoundsSaving || roundsLoadFailed}
                aria-invalid={callTimeoutError ? true : undefined}
                aria-describedby="a2a-call-timeout-help a2a-call-timeout-error a2a-collaboration-settings-error"
                className="min-h-11 w-full rounded border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--focus-ring)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)]/35 disabled:opacity-50 sm:min-h-9 sm:w-24"
              />
              <span className="shrink-0 whitespace-nowrap text-sm text-[var(--text-muted)]">
                {t("settings:minutesUnit")}
              </span>
            </div>
            <p id="a2a-call-timeout-help" className="mt-2 text-xs text-[var(--text-muted)]">
              {t("settings:a2aCallTimeoutMinutesHelp")}
            </p>
            {callTimeoutError && (
              <p
                id="a2a-call-timeout-error"
                role="alert"
                className="mt-2 text-xs text-[var(--status-error)]"
              >
                {callTimeoutError}
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              type="submit"
              size="sm"
              disabled={
                isRoundsSaving ||
                roundsLoadFailed ||
                (maxRoundsDraft === String(maxRounds ?? "") &&
                  callTimeoutDraft === String(callTimeoutMinutes ?? ""))
              }
              className="min-h-11 sm:min-h-9"
            >
              {isRoundsSaving && (
                <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
              )}
              {isRoundsSaving ? t("common:buttons.saving") : t("common:buttons.save")}
            </Button>
            {roundsLoadFailed && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="min-h-11 sm:min-h-9"
                onClick={() => void loadPrivacySettings()}
              >
                <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                {t("common:buttons.retry")}
              </Button>
            )}
          </div>
          {(roundsLoadFailed || collaborationSettingsError) && (
            <p
              id="a2a-collaboration-settings-error"
              role="alert"
              className="mt-2 text-xs text-[var(--status-error)]"
            >
              {collaborationSettingsError ?? t("settings:a2aCollaborationSettingsLoadFailed")}
            </p>
          )}
        </form>
        {conversationsError && (
          <div
            role="alert"
            className="mb-3 rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-3"
          >
            <div className="flex items-start gap-2">
              <AlertCircle
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-error)]"
              />
              <p className="text-xs leading-5 text-[var(--text-secondary)]">
                {t("settings:a2aConversationsUnavailable")}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2 min-h-11 sm:min-h-8"
              onClick={() => void fetchConversations()}
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
              {t("common:buttons.retry")}
            </Button>
          </div>
        )}
        {modesLoadFailed && (
          <div
            role="alert"
            className="mb-3 rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-3"
          >
            <div className="flex items-start gap-2">
              <AlertCircle
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-error)]"
              />
              <p className="text-xs leading-5 text-[var(--text-secondary)]">
                {t("settings:a2aModesLoadFailed")}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2 min-h-11 sm:min-h-8"
              onClick={() => void loadPrivacySettings()}
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
              {t("common:buttons.retry")}
            </Button>
          </div>
        )}
        <div className="space-y-1">
          {!conversationsError && conversations.length === 0 && (
            <p className="text-xs text-[var(--text-muted)]">{t("settings:noConversations")}</p>
          )}
          {conversations.slice(0, 10).map((conversation) => {
            const mode = a2aModes[conversation.id];
            const isPending = pendingConversationId === conversation.id;
            return (
              <div
                key={conversation.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border-color)] px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[var(--text-primary)]">
                    {conversation.title || t("common:sidebar.untitledConversation")}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--text-tertiary)]">
                    {mode
                      ? t(`settings:a2aModes.${mode}.description`)
                      : t("settings:privacyStatusUnavailable")}
                  </span>
                </div>
                <select
                  value={mode ?? ""}
                  disabled={!mode || isPending}
                  onChange={(event) =>
                    void handleA2AModeChange(conversation.id, event.target.value as A2AMode)
                  }
                  aria-label={t("settings:a2aModeFor", { conversation: conversation.title })}
                  className="min-h-11 shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-base)] px-2 py-1 text-xs text-[var(--text-primary)] disabled:opacity-50 sm:min-h-8"
                >
                  {!mode && <option value="">{t("settings:privacyStatusUnavailable")}</option>}
                  <option value="mention">{t("settings:a2aModes.mention.label")}</option>
                  <option value="call">{t("settings:a2aModes.call.label")}</option>
                  <option value="off">{t("settings:a2aModes.off.label")}</option>
                </select>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <ShieldAlert aria-hidden="true" className="h-4 w-4" />
          {t("settings:trustedHubs")}
        </h3>
        <p className="mb-3 text-xs text-[var(--text-tertiary)]">{t("settings:trustedHubsDesc")}</p>
        {trustLoadFailed && (
          <div
            role="alert"
            className="mb-3 rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-3"
          >
            <div className="flex items-start gap-2">
              <AlertCircle
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-error)]"
              />
              <p className="text-xs leading-5 text-[var(--text-secondary)]">
                {t("settings:trustedHubsLoadFailed")}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2 min-h-11 sm:min-h-8"
              onClick={() => void loadPrivacySettings()}
            >
              <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
              {t("common:buttons.retry")}
            </Button>
          </div>
        )}
        <div className="space-y-1">
          {!trustLoadFailed && trustList.length === 0 && (
            <p className="text-xs text-[var(--text-muted)]">{t("settings:noTrustedHubs")}</p>
          )}
          {trustList.map((hub) => (
            <div
              key={hub.hubId}
              className="flex items-center justify-between rounded-lg border border-[var(--border-color)] px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm text-[var(--text-primary)]">
                  {hub.userName ?? t("settings:unknownHub")}
                </span>
                <span className="block break-all font-mono text-[10px] text-[var(--text-tertiary)]">
                  {hub.hubFingerprint}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 px-3 sm:h-8 sm:px-2"
                  onClick={() => setTrustAction({ action: "block", hub })}
                  aria-label={t("settings:blockHubNamed", { name: hub.userName ?? hub.hubId })}
                >
                  <Ban aria-hidden="true" className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 px-3 text-[var(--status-error)] sm:h-8 sm:px-2"
                  onClick={() => setTrustAction({ action: "remove", hub })}
                  aria-label={t("settings:removeTrustNamed", { name: hub.userName ?? hub.hubId })}
                >
                  <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <Eye aria-hidden="true" className="h-4 w-4" />
          {t("settings:disclosurePreview")}
        </h3>
        <p className="mb-3 text-xs text-[var(--text-tertiary)]">
          {t("settings:disclosurePreviewDesc")}
        </p>
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] p-3">
          {agentsLoadError ? (
            <div role="alert">
              <div className="flex items-start gap-2">
                <AlertCircle
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-error)]"
                />
                <p className="text-xs leading-5 text-[var(--text-secondary)]">
                  {t("settings:disclosureUnavailable")}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2 min-h-11 sm:min-h-8"
                onClick={() => void fetchAgents()}
              >
                <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                {t("common:buttons.retry")}
              </Button>
            </div>
          ) : localAgents.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">{t("settings:noAgents")}</p>
          ) : (
            <ul className="space-y-1">
              {localAgents.map((agent) => (
                <li key={agent.id} className="flex items-center gap-2 text-sm">
                  <span className="h-2 w-2 rounded-full bg-[var(--accent-color)]" />
                  <span className="text-[var(--text-primary)]">{agent.name}</span>
                  <span className="text-[10px] text-[var(--text-tertiary)]">
                    {t("settings:trustLevelTrusted")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(trustAction)}
        title={t(
          trustAction?.action === "block" ? "settings:blockHubTitle" : "settings:removeTrustTitle",
        )}
        message={t(
          trustAction?.action === "block"
            ? "settings:blockHubMessage"
            : "settings:removeTrustMessage",
          { name: trustAction?.hub.userName ?? trustAction?.hub.hubId ?? "" },
        )}
        confirmLabel={t(
          trustAction?.action === "block" ? "settings:blockHub" : "settings:removeTrust",
        )}
        confirmingLabel={t("settings:updatingTrust")}
        isConfirming={isTrustActionPending}
        onConfirm={() => void confirmTrustAction()}
        onCancel={() => setTrustAction(null)}
      />
    </div>
  );
}
