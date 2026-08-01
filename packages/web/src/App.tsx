import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Sidebar } from "@/components/layout/Sidebar";
import { ChatArea } from "@/components/layout/ChatArea";
import { useChatStore } from "@/store/chatStore";
import { useAgentStore } from "@/store/agentStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { ToastContainer } from "@/components/common/ToastContainer";
import { useUIStore } from "@/store/uiStore";

export default function App() {
  const { t } = useTranslation(["common", "chat", "errors"]);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const isOffline = useUIStore((s) => s.isOffline);
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
  const openSidebar = useUIStore((s) => s.openSidebar);
  const closeSidebar = useUIStore((s) => s.closeSidebar);

  useWebSocket();

  // Init: load agents & conversations on mount
  useEffect(() => {
    fetchAgents();
    fetchConversations();
  }, [fetchAgents, fetchConversations]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      {isOffline && (
        <div
          role="alert"
          className="shrink-0 bg-red-700 px-4 py-2 text-center text-sm font-medium text-white"
        >
          {t("errors:offlineBanner")}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {isSidebarOpen && (
          <button
            type="button"
            onClick={closeSidebar}
            aria-label={t("common:aria.closeSidebar")}
            className="absolute inset-0 z-20 bg-black/60 md:hidden"
          />
        )}
        {/* Left sidebar — conversations + agent status */}
        <ErrorBoundary>
          <Sidebar />
        </ErrorBoundary>

        {/* Main chat area */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {currentConversationId ? (
            <ErrorBoundary>
              <ChatArea />
            </ErrorBoundary>
          ) : (
            <div className="relative flex flex-1 items-center justify-center">
              <button
                type="button"
                onClick={openSidebar}
                aria-label={t("common:aria.openSidebar")}
                className="absolute left-4 top-3 rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] md:hidden"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <div className="text-center">
                <h1 className="mb-2 text-2xl font-semibold text-[var(--text-secondary)]">
                  {t("common:appName")}
                </h1>
                <p className="text-sm text-[var(--text-muted)]">
                  {t("chat:chooseConversation")}
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}
