import { MessageList } from "@/components/message/MessageList";
import { Download, FileJson, FileText, Menu, MessageSquare, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { InputBar } from "@/components/layout/InputBar";
import { useChatStore } from "@/store/chatStore";
import { useAgentStore } from "@/store/agentStore";
import { useUIStore } from "@/store/uiStore";
import { STATUS_COLORS } from "@/constants/agent";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/services/api";
import { logger } from "@/utils/logger";
import { GroupMemberList } from "@/components/chat/GroupMemberList";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConnectionStatus } from "@/components/hub/ConnectionStatus";

export function ChatArea() {
  const { t } = useTranslation(["common", "chat"]);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const groupConversations = useChatStore((s) => s.groupConversations);
  const archivedConversations = useChatStore((s) => s.archivedConversations);
  const agents = useAgentStore((s) => s.agents);
  const pendingConfirmation = useChatStore((s) => s.a2aConfirmations[0]);
  const dismissA2AConfirmation = useChatStore((s) => s.dismissA2AConfirmation);
  const openSidebar = useUIStore((s) => s.openSidebar);
  const [confirmationSubmitting, setConfirmationSubmitting] = useState(false);
  const currentConv = [...conversations, ...groupConversations, ...archivedConversations]
    .find((c) => c.id === currentConversationId);
  const currentAgents = currentConv?.agentIds
    .map((agentId) => agents.find((agent) => agent.id === agentId))
    .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent)) ?? [];



  useEffect(() => {
    if (!pendingConfirmation) return;
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
      await api.confirmA2A(pendingConfirmation.threadId, approved);
    } catch (error) {
      logger.error("Failed to confirm A2A call", error);
    } finally {
      dismissA2AConfirmation(pendingConfirmation.threadId);
      setConfirmationSubmitting(false);
    }
  };

  const confirmationFrom = agents.find((agent) => agent.id === pendingConfirmation?.from)?.name
    ?? pendingConfirmation?.from;
  const confirmationTo = agents.find((agent) => agent.id === pendingConfirmation?.to)?.name
    ?? pendingConfirmation?.to;

  const [a2aMode, setA2aMode] = useState<"mention" | "call" | "off">("mention");

  useEffect(() => {
    if (!currentConv || currentConv.type !== "group") return;
    void api.getA2AMode(currentConv.id).then((res) => setA2aMode(res.mode)).catch(() => {});
  }, [currentConv]);

  const handleA2AModeChange = async (mode: "mention" | "call" | "off") => {
    setA2aMode(mode);
    if (currentConv) {
      try {
        await api.setA2AMode(currentConv.id, mode);
      } catch (error) {
        logger.error("Failed to set A2A mode", error);
      }
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
    } catch (error) {
      logger.error("Failed to export conversation", error);
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
          className="mr-3 rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] md:hidden"
        >
          <Menu aria-hidden="true" className="h-5 w-5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-sm">
            {currentConv?.type === "group"
              ? <Users aria-hidden="true" className="h-4 w-4" />
              : <MessageSquare aria-hidden="true" className="h-4 w-4" />}
          </div>
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-[var(--text-primary)]">
              {currentConv?.title ?? t("chat:defaultConversationTitle")}
            </h2>
            {currentConv?.type === "group" ? (
              <GroupMemberList conversation={currentConv} />
            ) : currentAgents.length > 0 && (
              <div className="mt-1 flex -space-x-1" aria-label={t("chat:participatingAgents")}>
                {currentAgents.map((agent) => (
                  <span key={agent.id} className="relative" title={`${agent.name} · ${t(`common:status.${agent.status}`)}`}>
                    <span className="block rounded-full ring-2 ring-[var(--bg-base)]">
                      <AgentAvatar name={agent.name} src={agent.avatar} size="xs" />
                    </span>
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[var(--bg-base)] ${STATUS_COLORS[agent.status]}`}
                    />
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <ConnectionStatus />

        {currentConv?.type === "group" && (
          <Select value={a2aMode} onValueChange={(v) => void handleA2AModeChange(v as "mention" | "call" | "off")}>
            <SelectTrigger className="h-8 w-auto gap-1.5 rounded-md border-[var(--border-color)] bg-[var(--bg-base)] px-2.5 text-xs text-[var(--text-secondary)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mention">{t("chat:a2aMention")}</SelectItem>
              <SelectItem value="call">{t("chat:a2aCall")}</SelectItem>
              <SelectItem value="off">{t("chat:a2aOff")}</SelectItem>
            </SelectContent>
          </Select>
        )}
        {currentConv && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={t("common:export.title")}>
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
          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={confirmationSubmitting}
              onClick={() => void handleA2AConfirmation(false)}
            >
              {t("chat:a2aConfirmation.deny")}
            </Button>
            <Button
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

