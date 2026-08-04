import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Shield, ShieldAlert, Trash2, Ban, Eye } from "lucide-react";
import { api, type A2AMode } from "@/services/api";
import { useAgentStore } from "@/store/agentStore";
import { useChatStore } from "@/store/chatStore";
import { Button } from "@/components/ui/button";
import { logger } from "@/utils/logger";

interface TrustedHub {
  hubId: string;
  hubFingerprint: string;
  userName?: string;
  trustLevel: string;
  lastSeenAt?: number;
  pairedAt?: number;
}

export function PrivacySettings() {
  const { t } = useTranslation(["common", "settings"]);
  const agents = useAgentStore((s) => s.agents);
  const dmConversations = useChatStore((s) => s.conversations);
  const groupConversations = useChatStore((s) => s.groupConversations);
  const conversations = useMemo(() => [...dmConversations, ...groupConversations], [dmConversations, groupConversations]);
  const [trustList, setTrustList] = useState<TrustedHub[]>([]);
  const [a2aModes, setA2aModes] = useState<Record<string, A2AMode>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    void (async () => {
      try {
      const [trust, ...modeResults] = await Promise.all([
        api.getTrustList().catch(() => [] as TrustedHub[]),
        ...conversations.slice(0, 20).map((conv) =>
          api.getA2AMode(conv.id).catch(() => ({ mode: "mention" as const })),
        ),
      ]);
      if (!active) return;
      setTrustList(trust as TrustedHub[]);
      const modes: Record<string, A2AMode> = {};
      conversations.slice(0, 20).forEach((conv, i) => {
        modes[conv.id] = modeResults[i]?.mode ?? "mention";
      });
      setA2aModes(modes);
      } catch (e) {
        logger.error("Failed to load privacy settings", e);
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [conversations]);

  const handleA2AModeChange = async (conversationId: string, mode: A2AMode) => {
    const previousMode = a2aModes[conversationId] ?? "mention";
    setA2aModes((prev) => ({ ...prev, [conversationId]: mode }));
    try {
      await api.setA2AMode(conversationId, mode);
    } catch (e) {
      logger.error("Failed to set A2A mode", e);
      setA2aModes((prev) => ({ ...prev, [conversationId]: previousMode }));
    }
  };

  const handleBlock = async (hubId: string) => {
    try {
      await api.blockHub(hubId);
      setTrustList((prev) => prev.filter((h) => h.hubId !== hubId));
    } catch (e) {
      logger.error("Failed to block hub", e);
    }
  };

  const handleRemove = async (hubId: string) => {
    try {
      await api.removeTrust(hubId);
      setTrustList((prev) => prev.filter((h) => h.hubId !== hubId));
    } catch (e) {
      logger.error("Failed to remove trust", e);
    }
  };

  const localAgents = agents.filter((a) => a.ownerType !== "remote");
  const visibleAgents = localAgents; // All local agents are visible to trusted hubs

  if (isLoading) {
    return <div className="p-4 text-sm text-[var(--text-muted)]">{t("common:loading")}</div>;
  }

  return (
    <div className="space-y-6">
      {/* A2A mode per conversation */}
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <Shield aria-hidden="true" className="h-4 w-4" />
          {t("settings:a2aMode")}
        </h3>
        <p className="mb-3 text-xs text-[var(--text-tertiary)]">
          {t("settings:a2aModeDesc")}
        </p>
        <div className="space-y-1">
          {conversations.length === 0 && (
            <p className="text-xs text-[var(--text-muted)]">{t("settings:noConversations")}</p>
          )}
          {conversations.slice(0, 10).map((conv) => (
            <div
              key={conv.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border-color)] px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm text-[var(--text-primary)]">
                  {conv.title || t("common:sidebar.untitledConversation")}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--text-tertiary)]">
                  {t(`settings:a2aModes.${a2aModes[conv.id] ?? "mention"}.description`)}
                </span>
              </div>
              <select
                value={a2aModes[conv.id] ?? "mention"}
                onChange={(e) => void handleA2AModeChange(conv.id, e.target.value as A2AMode)}
                aria-label={t("settings:a2aModeFor", { conversation: conv.title })}
                className="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-base)] px-2 py-1 text-xs text-[var(--text-primary)]"
              >
                <option value="mention">{t("settings:a2aModes.mention.label")}</option>
                <option value="call">{t("settings:a2aModes.call.label")}</option>
                <option value="off">{t("settings:a2aModes.off.label")}</option>
              </select>
            </div>
          ))}
        </div>
      </section>

      {/* Trusted Hubs */}
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <ShieldAlert aria-hidden="true" className="h-4 w-4" />
          {t("settings:trustedHubs")}
        </h3>
        <p className="mb-3 text-xs text-[var(--text-tertiary)]">
          {t("settings:trustedHubsDesc")}
        </p>
        <div className="space-y-1">
          {trustList.length === 0 && (
            <p className="text-xs text-[var(--text-muted)]">{t("settings:noTrustedHubs")}</p>
          )}
          {trustList.map((hub) => (
            <div
              key={hub.hubId}
              className="flex items-center justify-between rounded-lg border border-[var(--border-color)] px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm text-[var(--text-primary)]">
                  {hub.userName ?? "Unknown"}
                </span>
                <span className="block truncate text-[10px] text-[var(--text-tertiary)]">
                  {hub.hubFingerprint}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => void handleBlock(hub.hubId)}
                  aria-label={t("settings:blockHub")}
                >
                  <Ban aria-hidden="true" className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-red-500"
                  onClick={() => void handleRemove(hub.hubId)}
                  aria-label={t("settings:removeTrust")}
                >
                  <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Disclosure Preview */}
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <Eye aria-hidden="true" className="h-4 w-4" />
          {t("settings:disclosurePreview")}
        </h3>
        <p className="mb-3 text-xs text-[var(--text-tertiary)]">
          {t("settings:disclosurePreviewDesc")}
        </p>
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] p-3">
          {visibleAgents.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">{t("settings:noAgents")}</p>
          ) : (
            <ul className="space-y-1">
              {visibleAgents.map((agent) => (
                <li key={agent.id} className="flex items-center gap-2 text-sm">
                  <span className="h-2 w-2 rounded-full bg-teal-500" />
                  <span className="text-[var(--text-primary)]">{agent.name}</span>
                  <span className="text-[10px] text-[var(--text-tertiary)]">trusted</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
