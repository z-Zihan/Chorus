import { MessageList } from "@/components/message/MessageList";
import { useTranslation } from "react-i18next";
import { InputBar } from "@/components/layout/InputBar";
import { useChatStore } from "@/store/chatStore";
import { useAgentStore } from "@/store/agentStore";
import { useUIStore } from "@/store/uiStore";
import { STATUS_COLORS } from "@/constants/agent";

export function ChatArea() {
  const { t } = useTranslation(["common", "chat"]);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const agents = useAgentStore((s) => s.agents);
  const openSidebar = useUIStore((s) => s.openSidebar);
  const currentConv = conversations.find((c) => c.id === currentConversationId);
  const currentAgent = agents.find(
    (agent) => agent.id === currentConv?.agentIds[0]
  );

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
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-sm">
            {currentConv?.type === "dm" ? "💬" : "👥"}
          </div>
          <div>
            <h2 className="font-semibold text-[var(--text-primary)]">
              {currentConv?.title ?? t("chat:defaultConversationTitle")}
            </h2>
            {currentAgent && (
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    STATUS_COLORS[currentAgent.status]
                  }`}
                />
                {t(`common:status.${currentAgent.status}`)}
              </div>
            )}
          </div>
        </div>
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
