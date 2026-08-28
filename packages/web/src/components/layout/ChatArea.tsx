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
import type { Agent } from "@chorus/shared";
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
  const typingAgents = useChatStore((s) => s.typingAgents);
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

  // Single source of truth: Conversation.a2aMode in the chat store. A separate
  // per-view fetch used to go stale against edits made in the other view.
  const a2aMode: A2AMode | null =
    currentConv?.type === "group" ? (currentConv.a2aMode ?? null) : null;
  const [a2aModeError, setA2AModeError] = useState(false);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const [isAddAgentOpen, setIsAddAgentOpen] = useState(false);
  const [pendingAddAgentId, setPendingAddAgentId] = useState<string | null>(null);
  const [addAgentError, setAddAgentError] = useState<string | null>(null);

  const retryA2AMode = async () => {
    setA2AModeError(false);
    try {
      await fetchConversations();
    } catch (error) {
      logger.error("Failed to reload conversations for A2A mode", error);
      setA2AModeError(true);
    }
  };

  const handleA2AModeChange = async (mode: A2AMode) => {
    if (!a2aMode || !currentConv) return;
    const previousMode = a2aMode;
    // Optimistic store update keeps ChatArea and PrivacySettings consistent.
    syncConversation({ ...currentConv, a2aMode: mode });
    setA2AModeError(false);
    try {
      await api.setA2AMode(currentConv.id, mode, true);
    } catch (error) {
      syncConversation({ ...currentConv, a2aMode: previousMode });
      setA2AModeError(true);
      logger.error("Failed to set A2A mode", error);
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
      <header className="flex h-14 shrink-0 items-center border-b border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 md:px-6">
        <button
          type="button"
          onClick={openSidebar}
          aria-label={t("common:aria.openSidebar")}
          className="mr-1 flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] md:hidden"
        >
          <Menu aria-hidden="true" className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {currentConv?.type === "group" || currentConv?.type === "cross_hub" ? (
            <div className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)] sm:flex">
              <Users aria-hidden="true" className="h-4 w-4" />
            </div>
          ) : (
            currentAgents[0] && (
              <span
                className="relative hidden shrink-0 sm:block"
                title={`${currentAgents[0].name} · ${t(`common:status.${currentAgents[0].status}`)}`}
              >
                <AgentAvatar name={currentAgents[0].name} src={currentAgents[0].avatar} size="sm" />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-base)] ${STATUS_COLORS[currentAgents[0].status]}`}
                />
              </span>
            )
          )}
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold leading-5 text-[var(--text-primary)]">
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
            ) : null}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-0.5 md:gap-1">
          <ConnectionStatus />

          {currentConv && (currentConv.type === "group" || currentConv.type === "cross_hub") && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsAddAgentOpen(true)}
              aria-label={t("sidebar:addMyAgent")}
              title={t("sidebar:addMyAgent")}
              className="hidden h-11 w-11 text-[var(--text-secondary)] md:inline-flex md:h-8 md:w-8"
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
                        className={`relative h-11 min-w-11 px-2 md:h-8 md:w-8 md:px-0 ${a2aMode && a2aMode !== "off" ? "text-[var(--accent-hover)]" : "text-[var(--text-secondary)]"}`}
                        aria-label={
                          a2aMode
                            ? t("chat:a2aMode.label", { mode: t(`chat:a2aMode.${a2aMode}.label`) })
                            : t("chat:a2aMode.unavailable")
                        }
                      >
                        <Network aria-hidden="true" className="h-4 w-4" />
                        {a2aModeError && (
                          <CircleAlert
                            aria-hidden="true"
                            className="absolute right-0.5 top-0.5 h-3.5 w-3.5 text-[var(--status-error)]"
                          />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[280px] text-xs">
                    <p className="font-medium text-[var(--text-primary)]">
                      {a2aMode
                        ? t("chat:a2aMode.label", { mode: t(`chat:a2aMode.${a2aMode}.label`) })
                        : t("chat:a2aMode.unavailable")}
                    </p>
                    {a2aMode && (
                      <p className="mt-1 leading-5 text-[var(--text-tertiary)]">
                        {t(`chat:a2aMode.${a2aMode}.detail`)}
                      </p>
                    )}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <DropdownMenuContent align="end" className="w-72 p-2">
                <div className="px-2 pb-2 pt-1">
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {t("chat:a2aMode.title")}
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
                      disabled={!a2aMode}
                      onSelect={() => void handleA2AModeChange(value)}
                      className={`group/a2a relative items-start gap-3 px-2.5 py-2 ${selected ? "bg-[var(--accent-subtle)]" : ""}`}
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
                      {/* Detail panel: pure CSS on hover/keyboard highlight — no overlay layer,
                          so Escape keeps closing the menu. */}
                      <span className="pointer-events-none absolute right-full top-0 z-50 mr-2 hidden w-60 rounded-lg border border-[var(--border-color)] bg-[var(--bg-elevated)] p-3 text-xs leading-5 shadow-xl group-data-[highlighted]/a2a:block">
                        <span className="block font-medium text-[var(--text-primary)]">
                          {t(`chat:a2aMode.${value}.label`)}
                        </span>
                        <span className="mt-1 block text-[var(--text-tertiary)]">
                          {t(`chat:a2aMode.${value}.detail`)}
                        </span>
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
                  className="h-11 min-w-11 px-0 text-[var(--text-secondary)] md:h-8 md:px-3"
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
        </div>
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
      <TypingIndicator typingMap={typingAgents} agents={agents} />

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

/**
 * Live peer-input indicator fed by the server's `typing` events. Entries expire
 * client-side: a crashed peer would never send isTyping=false, so the timestamp
 * heartbeat in chatStore + this sweep keeps stale indicators from lingering.
 */
const TYPING_EXPIRE_MS = 6_000;

function TypingIndicator({
  typingMap,
  agents,
}: {
  typingMap: Record<string, number>;
  agents: Agent[];
}) {
  const { t } = useTranslation("chat");
  // Expire client-side: a crashed peer never sends isTyping=false. The interval
  // ticks into state so the expiry re-evaluates without impure render calls.
  const [now, setNow] = useState(() => Date.now());
  const typingCount = Object.keys(typingMap).length;
  useEffect(() => {
    if (typingCount === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [typingCount]);
  const active = Object.keys(typingMap).filter(
    (agentId) => now - (typingMap[agentId] ?? 0) < TYPING_EXPIRE_MS,
  );
  if (active.length === 0) return null;
  const names = active.map(
    (agentId) => agents.find((agent) => agent.id === agentId)?.name ?? agentId,
  );
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-4 pb-1 text-xs text-[var(--text-secondary)] sm:px-6"
    >
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--accent-warm)]" />
      {t("typingIndicator", { names: names.join(", ") })}
    </div>
  );
}
