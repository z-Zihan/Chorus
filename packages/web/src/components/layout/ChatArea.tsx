import { MessageList } from "@/components/message/MessageList";
import { Download, FileJson, FileText, Menu, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { InputBar } from "@/components/layout/InputBar";
import { useChatStore } from "@/store/chatStore";
import { useAgentStore } from "@/store/agentStore";
import { useUIStore } from "@/store/uiStore";
import { STATUS_COLORS } from "@/constants/agent";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/services/api";
import { logger } from "@/utils/logger";

export function ChatArea() {
  const { t } = useTranslation(["common", "chat"]);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const archivedConversations = useChatStore((s) => s.archivedConversations);
  const agents = useAgentStore((s) => s.agents);
  const openSidebar = useUIStore((s) => s.openSidebar);
  const currentConv = [...conversations, ...archivedConversations]
    .find((c) => c.id === currentConversationId);
  const currentAgent = agents.find((agent) => agent.id === currentConv?.agentIds[0]);

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
            <MessageSquare aria-hidden="true" className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-[var(--text-primary)]">
              {currentConv?.title ?? t("chat:defaultConversationTitle")}
            </h2>
            {currentAgent && (
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${STATUS_COLORS[currentAgent.status]}`}
                />
                {t(`common:status.${currentAgent.status}`)}
              </div>
            )}
          </div>
        </div>
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
    </div>
  );
}
