import { MessageList } from "@/components/message/MessageList";
import {
  ArrowLeftRight,
  AtSign,
  Bot,
  Ban,
  Check,
  CircleAlert,
  Download,
  FileJson,
  FileText,
  Menu,
  MessageSquare,
  Network,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { InputBar } from "@/components/layout/InputBar";
import { useChatStore } from "@/store/chatStore";
import { useAgentStore } from "@/store/agentStore";
import { useUIStore } from "@/store/uiStore";
import { useHubStore } from "@/store/hubStore";
import { STATUS_COLORS } from "@/constants/agent";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, type A2AMode } from "@/services/api";
import { logger } from "@/utils/logger";
import { GroupMemberList } from "@/components/chat/GroupMemberList";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConnectionStatus } from "@/components/hub/ConnectionStatus";

const A2A_MODE_OPTIONS = [
  { value: "mention", icon: AtSign },
  { value: "call", icon: ArrowLeftRight },
  { value: "off", icon: Ban },
] as const;

export function ChatArea() {
  const { t } = useTranslation(["common", "chat"]);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const groupConversations = useChatStore((s) => s.groupConversations);
  const archivedConversations = useChatStore((s) => s.archivedConversations);
  const agents = useAgentStore((s) => s.agents);
  const pendingConfirmation = useChatStore((s) => s.a2aConfirmations[0]);
  const dismissA2AConfirmation = useChatStore((s) => s.dismissA2AConfirmation);
  const syncConversation = useChatStore((s) => s.syncConversation);
  const openSidebar = useUIStore((s) => s.openSidebar);
  const hubConnectionState = useHubStore((s) => s.hubConnectionState);
  const [confirmationSubmitting, setConfirmationSubmitting] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const currentConv = [...conversations, ...groupConversations, ...archivedConversations].find(
    (c) => c.id === currentConversationId,
  );
  const currentAgents =
    currentConv?.agentIds
      .map((agentId) => agents.find((agent) => agent.id === agentId))
      .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent)) ?? [];

  useEffect(() => {
    if (!pendingConfirmation) return;
    setConfirmationError(null);
    const remaining = pendingConfirmation.expiresAt - Date.now();
    if (remaining <= 0) {
      dismissA2AConfirmation(pendingConfirmation.threadId);
      return;
    }
    const timeout = setTimeout(
      () => dismissA2AConfirmation(pendingConfirmation.threadId),
      remaining,
    );
    return () => clearTimeout(timeout);
  }, [dismissA2AConfirmation, pendingConfirmation]);

  const handleA2AConfirmation = async (approved: boolean) => {
    if (!pendingConfirmation || confirmationSubmitting) return;
    setConfirmationSubmitting(true);
    try {
      await api.confirmA2A(pendingConfirmation.threadId, approved, true);
      dismissA2AConfirmation(pendingConfirmation.threadId);
    } catch (error) {
      logger.error("Failed to confirm A2A call", error);
      setConfirmationError(t("chat:a2aConfirmation.submitFailed"));
    } finally {
      setConfirmationSubmitting(false);
    }
  };

  const confirmationFrom =
    agents.find((agent) => agent.id === pendingConfirmation?.from)?.name ??
    pendingConfirmation?.from;
  const confirmationTo =
    agents.find((agent) => agent.id === pendingConfirmation?.to)?.name ?? pendingConfirmation?.to;

  const [a2aMode, setA2aMode] = useState<A2AMode | null>(null);
  const [isA2AModeLoading, setIsA2AModeLoading] = useState(false);
  const [a2aModeError, setA2AModeError] = useState(false);
  const [isAddAgentOpen, setIsAddAgentOpen] = useState(false);
  const [pendingAddAgentId, setPendingAddAgentId] = useState<string | null>(null);
  const [addAgentError, setAddAgentError] = useState<string | null>(null);
  const [showA2ATooltip, setShowA2ATooltip] = useState(false);
  const currentConversationIdForMode = currentConv?.id;
  const currentConversationTypeForMode = currentConv?.type;

  useEffect(() => {
    let active = true;
    if (!currentConversationIdForMode || currentConversationTypeForMode !== "group") {
      setA2aMode(null);
      setA2AModeError(false);
      return () => {
        active = false;
      };
    }
    setIsA2AModeLoading(true);
    setA2AModeError(false);
    void api
      .getA2AMode(currentConversationIdForMode, true)
      .then((result) => {
        if (active) setA2aMode(result.mode);
      })
      .catch((error: unknown) => {
        logger.error("Failed to load A2A mode", error);
        if (active) {
          setA2aMode(null);
          setA2AModeError(true);
        }
      })
      .finally(() => {
        if (active) setIsA2AModeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentConversationIdForMode, currentConversationTypeForMode]);

  const retryA2AMode = async () => {
    if (!currentConversationIdForMode || currentConversationTypeForMode !== "group") return;
    setIsA2AModeLoading(true);
    setA2AModeError(false);
    try {
      setA2aMode((await api.getA2AMode(currentConversationIdForMode, true)).mode);
    } catch (error) {
      logger.error("Failed to load A2A mode", error);
      setA2aMode(null);
      setA2AModeError(true);
    } finally {
      setIsA2AModeLoading(false);
    }
  };

  const handleA2AModeChange = async (mode: A2AMode) => {
    if (!a2aMode || isA2AModeLoading) return;
    const previousMode = a2aMode;
    setA2aMode(mode);
    setA2AModeError(false);
    if (currentConv) {
      try {
        await api.setA2AMode(currentConv.id, mode, true);
      } catch (error) {
        setA2aMode(previousMode);
        setA2AModeError(true);
        logger.error("Failed to set A2A mode", error);
      }
    }
  };

  const availableAddAgents = agents.filter(
    (agent) =>
      agent.ownerType !== "remote" &&
      agent.status !== "offline" &&
      !agent.stale &&
      !currentConv?.agentIds.includes(agent.id),
  );

  const handleAddAgent = async (agentId: string) => {
    if (!currentConv || pendingAddAgentId) return;
    setPendingAddAgentId(agentId);
    setAddAgentError(null);
    try {
      if (currentConv.relayRoomId) {
        await api.addAgentToRoom(currentConv.relayRoomId, agentId, true);
        syncConversation(await api.getHubRoom(currentConv.relayRoomId, true));
      } else {
        syncConversation(await api.addConversationMembers(currentConv.id, [agentId], true));
      }
      useUIStore.getState().addToast(t("chat:memberAdded"), "success");
      setIsAddAgentOpen(false);
    } catch (error) {
      logger.error("Failed to add Agent to conversation", error);
      setAddAgentError(t("chat:addMemberFailed"));
    } finally {
      setPendingAddAgentId(null);
    }
  };

  const handleExport = async (format: "markdown" | "json") => {
    if (!currentConv) return;
    try {
      const blob = await api.exportConversation(currentConv.id, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeTitle = currentConv.title.replace(/[^\p{L}\p{N}._-]+/gu, "-") || "conversation";
      link.href = url;
      link.download = `${safeTitle}.${format === "markdown" ? "md" : "json"}`;
      link.click();
      URL.revokeObjectURL(url);
      useUIStore.getState().addToast(t("common:export.success"), "success");
    } catch (error) {
      logger.error("Failed to export conversation", error);
      useUIStore.getState().addToast(t("common:export.failed"), "error");
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-14 items-center border-b border-[var(--border-color)] bg-[var(--bg-base)] px-4 md:px-6">
        <button
          type="button"
          onClick={openSidebar}
          aria-label={t("common:aria.openSidebar")}
          className="mr-1 flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] md:hidden"
        >
          <Menu aria-hidden="true" className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="hidden h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-sm sm:flex">
            {currentConv?.type === "group" ? (
              <Users aria-hidden="true" className="h-4 w-4" />
            ) : (
              <MessageSquare aria-hidden="true" className="h-4 w-4" />
            )}
          </div>
          <div className="flex min-w-0 items-center gap-1 sm:block">
            <h1 className="truncate font-semibold text-[var(--text-primary)]">
              {currentConv?.title ?? t("chat:defaultConversationTitle")}
            </h1>
            {currentConv && (currentConv.type === "group" || currentConv.type === "cross_hub") ? (
              <>
                <GroupMemberList conversation={currentConv} />
                <Dialog open={isAddAgentOpen} onOpenChange={setIsAddAgentOpen}>
                  <DialogContent>
                    <DialogTitle>{t("sidebar:addAgentToRoom")}</DialogTitle>
                    <DialogDescription>{t("sidebar:selectAgentToAdd")}</DialogDescription>
                    <div className="mt-4 space-y-1">
                      {availableAddAgents.map((agent) => (
                        <button
                          key={agent.id}
                          type="button"
                          disabled={Boolean(pendingAddAgentId)}
                          className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-[var(--bg-hover)] disabled:opacity-50"
                          onClick={() => void handleAddAgent(agent.id)}
                        >
                          <AgentAvatar name={agent.name} src={agent.avatar} size="sm" />
                          <span className="text-sm text-[var(--text-primary)]">{agent.name}</span>
                        </button>
                      ))}
                      {addAgentError && (
                        <p
                          role="alert"
                          className="rounded-lg bg-[var(--status-error)]/5 px-3 py-2 text-xs text-[var(--status-error)]"
                        >
                          {addAgentError}
                        </p>
                      )}
                      {availableAddAgents.length === 0 && (
                        <p className="py-4 text-center text-sm text-[var(--text-muted)]">
                          {t("sidebar:noAgents")}
                        </p>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              </>
            ) : (
              currentAgents.length > 0 && (
                <div className="mt-1 flex -space-x-1" aria-label={t("chat:participatingAgents")}>
                  {currentAgents.map((agent) => (
                    <span
                      key={agent.id}
                      className="relative"
                      title={`${agent.name} · ${t(`common:status.${agent.status}`)}`}
                    >
                      <span className="block rounded-full ring-2 ring-[var(--bg-base)]">
                        <AgentAvatar name={agent.name} src={agent.avatar} size="xs" />
                      </span>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[var(--bg-base)] ${STATUS_COLORS[agent.status]}`}
                      />
                    </span>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
        <ConnectionStatus />

        {currentConv?.type === "group" && (
          <TooltipProvider delayDuration={250}>
            <Tooltip open={showA2ATooltip || undefined}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowA2ATooltip(false)}
                  aria-label={t("chat:a2aMode.title")}
                  title={t("chat:a2aMode.title")}
                  className="hidden h-11 w-11 md:inline-flex md:h-8 md:w-8"
                >
                  <Network aria-hidden="true" className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[200px] text-xs">
                {t("chat:a2aTooltipFirst")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {currentConv && (currentConv.type === "group" || currentConv.type === "cross_hub") && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsAddAgentOpen(true)}
            aria-label={t("sidebar:addMyAgent")}
            title={t("sidebar:addMyAgent")}
            className="hidden h-11 w-11 md:inline-flex md:h-8 md:w-8"
          >
            <Bot aria-hidden="true" className="h-4 w-4" />
          </Button>
        )}
        {currentConv?.type === "group" && (
          <DropdownMenu>
            <TooltipProvider delayDuration={250}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`relative h-11 w-11 px-0 md:h-8 md:w-8 ${a2aMode && a2aMode !== "off" ? "text-[var(--accent-hover)]" : ""}`}
                      aria-label={
                        a2aMode
                          ? t("chat:a2aMode.label", { mode: t(`chat:a2aMode.${a2aMode}.label`) })
                          : t("chat:a2aMode.unavailable")
                      }
                    >
                      <Network aria-hidden="true" className="h-4 w-4" />
                      {a2aMode && a2aMode !== "off" && (
                        <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--accent-color)]" />
                      )}
                      {a2aModeError && (
                        <CircleAlert
                          aria-hidden="true"
                          className="absolute right-0 top-0 h-3.5 w-3.5 text-[var(--status-error)]"
                        />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  {a2aMode
                    ? t("chat:a2aMode.label", { mode: t(`chat:a2aMode.${a2aMode}.label`) })
                    : t("chat:a2aMode.unavailable")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <DropdownMenuContent align="end" className="w-80 p-2">
              <div className="px-2 pb-2 pt-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {t("chat:a2aMode.title")}
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                  {t("chat:a2aMode.description")}
                </p>
              </div>
              {a2aModeError && (
                <div
                  role="alert"
                  className="mx-2 mb-2 rounded-lg bg-[var(--status-error)]/5 p-2 text-xs leading-5 text-[var(--text-secondary)]"
                >
                  <p>{t("chat:a2aMode.loadFailed")}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2 min-h-11 md:min-h-8"
                    onClick={() => void retryA2AMode()}
                  >
                    {t("common:buttons.retry")}
                  </Button>
                </div>
              )}
              {A2A_MODE_OPTIONS.map(({ value, icon: Icon }) => {
                const selected = value === a2aMode;
                return (
                  <DropdownMenuItem
                    key={value}
                    disabled={!a2aMode || isA2AModeLoading}
                    onSelect={() => void handleA2AModeChange(value)}
                    className={`items-start gap-3 px-2.5 py-2.5 ${selected ? "bg-[var(--accent-subtle)]" : ""}`}
                  >
                    <span
                      className={`mt-0.5 rounded-md p-1.5 ${selected ? "bg-[var(--accent-color)] text-white" : "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"}`}
                    >
                      <Icon aria-hidden="true" className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-sm font-medium ${selected ? "text-[var(--accent-hover)]" : "text-[var(--text-primary)]"}`}
                      >
                        {t(`chat:a2aMode.${value}.label`)}
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-[var(--text-tertiary)]">
                        {t(`chat:a2aMode.${value}.description`)}
                      </span>
                    </span>
                    <span
                      className={`mt-1 flex h-4 w-4 items-center justify-center rounded-full border ${selected ? "border-[var(--accent-color)] bg-[var(--accent-color)] text-white" : "border-[var(--border-color)]"}`}
                    >
                      {selected && <Check aria-hidden="true" className="h-3 w-3" />}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {currentConv && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-11 min-w-11 px-0 md:h-8 md:px-3"
                aria-label={t("common:export.title")}
              >
                <Download aria-hidden="true" className="h-4 w-4" />
                <span className="hidden sm:inline">{t("common:export.title")}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void handleExport("markdown")}>
                <FileText aria-hidden="true" className="h-4 w-4" />
                {t("common:export.markdown")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleExport("json")}>
                <FileJson aria-hidden="true" className="h-4 w-4" />
                {t("common:export.json")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {currentConv?.type === "cross_hub" &&
        currentConv.relayRoomId &&
        (hubConnectionState === "disconnected" || hubConnectionState === "error") && (
          <div
            role="status"
            className="border-b border-[var(--status-error)]/35 bg-[var(--danger-subtle)] px-4 py-2 text-center text-sm font-medium text-[var(--status-error)]"
          >
            {t("chat:relayDisconnected")}
          </div>
        )}

      {/* Messages */}
      <div className="flex-1 overflow-hidden">
        <MessageList />
      </div>

      {/* Input */}
      <InputBar />

      <Dialog
        open={Boolean(pendingConfirmation)}
        onOpenChange={(open) => {
          if (!open) void handleA2AConfirmation(false);
        }}
      >
        <DialogContent>
          <DialogTitle>{t("chat:a2aConfirmation.title")}</DialogTitle>
          <DialogDescription className="mt-2">
            {t("chat:a2aConfirmation.description", {
              from: confirmationFrom,
              to: confirmationTo,
            })}
          </DialogDescription>
          {pendingConfirmation?.message && (
            <p className="mt-3 max-h-32 overflow-auto rounded-lg bg-[var(--bg-elevated)] p-3 text-sm text-[var(--text-secondary)]">
              {pendingConfirmation.message}
            </p>
          )}
          {confirmationError && (
            <p role="alert" className="mt-3 text-sm text-[var(--status-error)]">
              {confirmationError}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="secondary"
              className="min-h-11 sm:min-h-10"
              disabled={confirmationSubmitting}
              onClick={() => void handleA2AConfirmation(false)}
            >
              {t("chat:a2aConfirmation.deny")}
            </Button>
            <Button
              className="min-h-11 sm:min-h-10"
              disabled={confirmationSubmitting}
              onClick={() => void handleA2AConfirmation(true)}
            >
              {t("chat:a2aConfirmation.approve")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
