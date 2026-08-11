import { useCallback, useEffect, useState } from "react";
import type { RoomInvitation } from "@chorus/shared";
import { Check, Clock3, Mail, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { api } from "@/services/api";
import { useChatStore } from "@/store/chatStore";
import { useUIStore } from "@/store/uiStore";

const REFRESH_INTERVAL_MS = 15_000;

export function RoomInvitations() {
  const { t, i18n } = useTranslation(["sidebar", "common"]);
  const [invitations, setInvitations] = useState<RoomInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);
  const fetchConversations = useChatStore((state) => state.fetchConversations);
  const setCurrentConversation = useChatStore((state) => state.setCurrentConversation);
  const addToast = useUIStore((state) => state.addToast);

  const refresh = useCallback(async () => {
    try {
      const response = await api.getRoomInvitations();
      setInvitations(response.invitations);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const accept = async (invitation: RoomInvitation) => {
    setPendingRoomId(invitation.roomId);
    try {
      const result = await api.acceptRoomInvitation(invitation.roomId);
      await fetchConversations();
      setCurrentConversation(result.conversation.id);
      setInvitations((current) => current.filter((item) => item.roomId !== invitation.roomId));
      addToast(t("sidebar:roomInvitationAccepted", { room: invitation.roomName }), "success");
    } catch {
      addToast(
        t(
          invitation.status === "accepted"
            ? "sidebar:roomInvitationRecoveryFailed"
            : "sidebar:roomInvitationAcceptFailed",
          { room: invitation.roomName },
        ),
        "error",
      );
    } finally {
      setPendingRoomId(null);
    }
  };

  const decline = async (invitation: RoomInvitation) => {
    setPendingRoomId(invitation.roomId);
    try {
      await api.declineRoomInvitation(invitation.roomId);
      setInvitations((current) => current.filter((item) => item.roomId !== invitation.roomId));
      addToast(t("sidebar:roomInvitationDeclined", { room: invitation.roomName }), "info");
    } catch {
      addToast(t("sidebar:roomInvitationDeclineFailed", { room: invitation.roomName }), "error");
    } finally {
      setPendingRoomId(null);
    }
  };

  if (isLoading) {
    return (
      <div
        role="status"
        className="mb-4 flex items-center gap-2 px-2 text-xs text-[var(--text-muted)]"
      >
        <RefreshCw aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        {t("sidebar:checkingInvitations")}
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div
        role="alert"
        className="mb-4 rounded-lg bg-[var(--danger-subtle)] p-3 text-xs text-[var(--status-error)]"
      >
        <p>{t("sidebar:invitationLoadFailed")}</p>
        <Button variant="ghost" size="sm" className="mt-1 h-7 px-2" onClick={() => void refresh()}>
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
          {t("common:buttons.retry")}
        </Button>
      </div>
    );
  }

  if (invitations.length === 0) return null;

  return (
    <section className="mb-4" aria-labelledby="room-invitations-title">
      <div className="flex items-center gap-2 px-2 pb-2">
        <Mail aria-hidden="true" className="h-3.5 w-3.5 text-[var(--status-busy)]" />
        <h2
          id="room-invitations-title"
          className="flex-1 text-xs font-semibold text-[var(--text-secondary)]"
        >
          {t("sidebar:roomInvitations")}
        </h2>
        <span className="rounded-full bg-[var(--warning-subtle)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--status-busy)]">
          {invitations.length}
        </span>
      </div>
      <div className="space-y-2">
        {invitations.map((invitation) => {
          const isPending = pendingRoomId === invitation.roomId;
          const needsRecovery = invitation.status === "accepted";
          const inviter = invitation.invitedByName ?? invitation.invitedByHubId.slice(0, 10);
          return (
            <article
              key={invitation.roomId}
              className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] p-3"
            >
              <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                {invitation.roomName}
              </p>
              <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                {t("sidebar:invitedBy", { name: inviter })}
              </p>
              {needsRecovery ? (
                <p className="mt-1 text-[10px] text-[var(--status-busy)]">
                  {t("sidebar:roomInvitationNeedsRecovery")}
                </p>
              ) : (
                <p className="mt-1 flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]">
                  <Clock3 aria-hidden="true" className="h-3 w-3" />
                  {t("sidebar:invitationExpires", {
                    time: new Intl.DateTimeFormat(i18n.language, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(invitation.expiresAt),
                  })}
                </p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  className={needsRecovery ? "col-span-2" : undefined}
                  disabled={isPending}
                  onClick={() => void accept(invitation)}
                >
                  <Check aria-hidden="true" className="h-3.5 w-3.5" />
                  {t(needsRecovery ? "sidebar:finishRoomSetup" : "sidebar:acceptInvitation")}
                </Button>
                {!needsRecovery && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isPending}
                    onClick={() => void decline(invitation)}
                  >
                    <X aria-hidden="true" className="h-3.5 w-3.5" />
                    {t("sidebar:declineInvitation")}
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
