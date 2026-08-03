import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Sidebar } from "@/components/layout/Sidebar";
import { ChatArea } from "@/components/layout/ChatArea";
import { useChatStore } from "@/store/chatStore";
import { useAgentStore } from "@/store/agentStore";
import { useWebSocket } from "@/hooks/useWebSocket";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { ToastContainer } from "@/components/common/ToastContainer";
import { UpdateBanner } from "@/components/common/UpdateBanner";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { useOnboardingStore } from "@/store/onboardingStore";
import { useUIStore } from "@/store/uiStore";
import { useHotkeys } from "@/hooks/useHotkey";
import { SearchPanel } from "@/components/search/SearchPanel";
import { AgentSettingsPanel } from "@/components/agent/AgentSettingsPanel";
import { SettingsPanel } from "@/components/common/SettingsPanel";

export default function App() {
  const { t } = useTranslation(["common", "chat", "errors"]);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const isOffline = useUIStore((s) => s.isOffline);
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
  const openSidebar = useUIStore((s) => s.openSidebar);
  const closeSidebar = useUIStore((s) => s.closeSidebar);
  const agents = useAgentStore((s) => s.agents);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const clearSelectedAgent = useAgentStore((s) => s.clearSelectedAgent);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useWebSocket();
  const onboardingStatus = useOnboardingStore((s) => s.status);

  useHotkeys(
    [
      { key: "Ctrl+K", callback: () => setIsSearchOpen(true) },
      {
        key: "Ctrl+,",
        callback: () => {
          if (selectedAgentId) clearSelectedAgent();
          else if (agents[0]) selectAgent(agents[0].id);
        },
      },
      {
        key: "Escape",
        callback: () => {
          clearSelectedAgent();
          closeSidebar();
        },
      },
    ],
    [agents, selectedAgentId, selectAgent, clearSelectedAgent, closeSidebar],
  );

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
      <UpdateBanner />

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
          <Sidebar onOpenSettings={() => setIsSettingsOpen(true)} />
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
                <Menu aria-hidden="true" className="h-5 w-5" />
              </button>
              <div className="text-center">
                <h1 className="mb-2 text-2xl font-semibold text-[var(--text-secondary)]">
                  {t("common:appName")}
                </h1>
                <p className="text-sm text-[var(--text-muted)]">{t("chat:chooseConversation")}</p>
              </div>
            </div>
          )}
        </main>
      </div>
      {onboardingStatus && onboardingStatus.step !== "completed" && <OnboardingFlow />}
      <ToastContainer />
      <SearchPanel open={isSearchOpen} onOpenChange={setIsSearchOpen} />
      <AgentSettingsPanel />
      <SettingsPanel open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </div>
  );
}
