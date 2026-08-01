import { useState } from "react";
import { MessageSquare, Plus, Settings, Trash2, X } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { useChatStore, type Conversation } from "@/store/chatStore";
import { useAgentStore } from "@/store/agentStore";
import { useUIStore } from "@/store/uiStore";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { AgentSettingsPanel } from "@/components/agent/AgentSettingsPanel";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { STATUS_COLORS } from "@/constants/agent";
import { formatConversationTime } from "@/lib/date";

export function Sidebar() {
  const { t } = useTranslation(["common", "sidebar"]);
  const [conversationToDelete, setConversationToDelete] = useState<Conversation | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const conversations = useChatStore((s) => s.conversations);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const setCurrentConversation = useChatStore((s) => s.setCurrentConversation);
  const createConversation = useChatStore((s) => s.createConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const agents = useAgentStore((s) => s.agents);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
  const closeSidebar = useUIStore((s) => s.closeSidebar);

  const handleSelectConversation = (id: string) => {
    setCurrentConversation(id);
    closeSidebar();
  };

  const handleCreateConversation = async () => {
    await createConversation();
    closeSidebar();
  };

  const handleConfirmDelete = async () => {
    if (!conversationToDelete) return;
    setIsDeleting(true);
    const deleted = await deleteConversation(conversationToDelete.id);
    setIsDeleting(false);
    if (deleted) setConversationToDelete(null);
  };

  return (
    <>
      <aside
        className={`absolute inset-y-0 left-0 z-30 flex h-full w-72 max-w-[85vw] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-surface)] shadow-2xl transition-transform duration-200 md:static md:max-w-none md:translate-x-0 md:shadow-none ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo / Brand */}
        <div className="flex h-14 items-center gap-2 border-b border-[var(--border-color)] px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-color)] text-sm font-bold text-white">
            AL
          </div>
          <span className="flex-1 font-semibold text-[var(--text-primary)]">
            {t("common:appName")}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void handleCreateConversation()}
            aria-label={t("sidebar:createConversation")}
            title={t("sidebar:createConversation")}
            className="h-8 w-8"
          >
            <Plus aria-hidden="true" className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={closeSidebar}
            aria-label={t("common:aria.closeSidebar")}
            className="h-8 w-8 md:hidden"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </Button>
        </div>

        {/* Conversations */}
        <div className="flex-1 overflow-y-auto px-2 py-3">
          <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
            {t("sidebar:conversations")}
          </div>
          <div className="space-y-1">
            {conversations.length === 0 && (
              <div className="rounded-lg border border-dashed border-[var(--border-color)] px-4 py-6 text-center">
                <p className="text-sm text-[var(--text-tertiary)]">
                  {t("sidebar:noConversations")}
                </p>
                <Button onClick={() => void handleCreateConversation()} size="sm" className="mt-3">
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  {t("sidebar:createConversation")}
                </Button>
              </div>
            )}
            {conversations.map((conv) => {
              const conversationAgent = agents.find((agent) => agent.id === conv.agentIds[0]);
              const isAgentOffline = conversationAgent?.status === "offline";

              return (
                <div key={conv.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => handleSelectConversation(conv.id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 pr-10 text-left transition-colors ${
                      currentConversationId === conv.id
                        ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-sm">
                      <MessageSquare aria-hidden="true" className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-medium">
                          {conv.title || t("sidebar:untitledConversation")}
                        </div>
                        {isAgentOffline && (
                          <span className="shrink-0 rounded bg-amber-950 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-amber-800">
                            {t("common:status.offline")}
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-[var(--text-muted)]">
                        {formatConversationTime(conv.updatedAt)}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConversationToDelete(conv)}
                    aria-label={t("sidebar:deleteConversationAria", {
                      title: conv.title || t("sidebar:untitledConversation"),
                    })}
                    title={t("sidebar:deleteConversation")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[var(--text-tertiary)] opacity-100 transition hover:bg-red-950 hover:text-red-400 focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Agent status list */}
        <div className="border-t border-[var(--border-color)] px-2 py-3">
          <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
            {t("sidebar:agentStatus")}
          </div>
          <div className="space-y-1">
            {agents.length === 0 && (
              <p className="px-2 py-2 text-sm text-[var(--text-muted)]">{t("sidebar:noAgents")}</p>
            )}
            {agents.map((agent) => (
              <button
                type="button"
                key={agent.id}
                onClick={() => selectAgent(agent.id)}
                className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-hover)] focus:outline-none"
              >
                <AgentAvatar name={agent.name} src={agent.avatar} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {agent.name}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_COLORS[agent.status]}`} />
                    {t(`common:status.${agent.status}`)}
                  </div>
                </div>
                <Settings
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-[var(--text-tertiary)] opacity-100 transition group-hover:text-[var(--text-primary)] md:opacity-0 md:group-hover:opacity-100 md:group-focus:opacity-100"
                />
              </button>
            ))}
          </div>
        </div>
      </aside>

      <ConfirmDialog
        open={Boolean(conversationToDelete)}
        title={t("sidebar:deleteDialogTitle")}
        message={
          <Trans
            i18nKey="sidebar:deleteDialogMessage"
            values={{ title: conversationToDelete?.title || t("sidebar:untitledConversation") }}
          />
        }
        confirmLabel={t("common:buttons.delete")}
        isConfirming={isDeleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setConversationToDelete(null)}
      />
      <AgentSettingsPanel />
    </>
  );
}
