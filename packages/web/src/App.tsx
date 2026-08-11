import { lazy, Suspense, useEffect, useState } from "react";
import { Menu, MessageSquarePlus, Settings2 } from "lucide-react";
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
import { AgentSettingsPanel } from "@/components/agent/AgentSettingsPanel";
import { BrandMark } from "@/components/common/BrandMark";
import { Button } from "@/components/ui/button";

const SearchPanel = lazy(() =>
  import("@/components/search/SearchPanel").then((module) => ({ default: module.SearchPanel })),
);
const SettingsPanel = lazy(() =>
  import("@/components/common/SettingsPanel").then((module) => ({ default: module.SettingsPanel })),
);
const MessageStatusFixture = import.meta.env.DEV
  ? lazy(() =>
      import("@/components/message/MessageStatusFixture").then((module) => ({
        default: module.MessageStatusFixture,
      })),
    )
  : null;
const LoadErrorFixture = import.meta.env.DEV
  ? lazy(() =>
      import("@/components/message/LoadErrorFixture").then((module) => ({
        default: module.LoadErrorFixture,
      })),
    )
  : null;
const UpdateBannerFixture = import.meta.env.DEV
  ? lazy(() =>
      import("@/components/common/UpdateBannerFixture").then((module) => ({
        default: module.UpdateBannerFixture,
      })),
    )
  : null;

export default function App() {
  const fixture = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("fixture")
    : null;
  if (fixture === "message-status" && MessageStatusFixture) {
    return (
      <Suspense fallback={null}>
        <MessageStatusFixture />
      </Suspense>
    );
  }
  if (fixture === "load-error" && LoadErrorFixture) {
    return (
      <Suspense fallback={null}>
        <LoadErrorFixture />
      </Suspense>
    );
  }
  if (fixture === "update-banner" && UpdateBannerFixture) {
    return (
      <Suspense fallback={null}>
        <UpdateBannerFixture />
      </Suspense>
    );
  }
  return <AppShell />;
}

function AppShell() {
  const { t } = useTranslation(["common", "chat", "errors", "sidebar"]);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const fetchHealthStatus = useAgentStore((s) => s.fetchHealthStatus);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const createConversation = useChatStore((s) => s.createConversation);
  const isOffline = useUIStore((s) => s.isOffline);
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
  const openSidebar = useUIStore((s) => s.openSidebar);
  const closeSidebar = useUIStore((s) => s.closeSidebar);
  const addToast = useUIStore((s) => s.addToast);
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
    void fetchAgents().then(fetchHealthStatus);
    void fetchConversations();
  }, [fetchAgents, fetchConversations, fetchHealthStatus]);

  useEffect(() => {
    if (onboardingStatus?.step !== "completed") return;
    void fetchAgents().then(fetchHealthStatus);
    void fetchConversations();
  }, [onboardingStatus?.step, fetchAgents, fetchConversations, fetchHealthStatus]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-[100] inline-flex min-h-11 -translate-y-24 items-center rounded-lg bg-[var(--accent-color)] px-4 py-2 font-medium text-[var(--accent-foreground)] shadow-lg transition-transform focus:translate-y-0"
      >
        {t("common:aria.skipToContent")}
      </a>
      {isOffline && (
        <div
          role="alert"
          className="shrink-0 border-b border-[var(--status-error)]/35 bg-[var(--danger-subtle)] px-4 py-2 text-center text-sm font-medium text-[var(--status-error)]"
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
        <main
          id="main-content"
          tabIndex={-1}
          className="flex min-w-0 flex-1 flex-col overflow-hidden"
        >
          {currentConversationId ? (
            <ErrorBoundary>
              <ChatArea />
            </ErrorBoundary>
          ) : (
            <div className="relative flex flex-1 items-center justify-center px-6">
              <button
                type="button"
                onClick={openSidebar}
                aria-label={t("common:aria.openSidebar")}
                className="absolute left-4 top-3 rounded-lg p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] md:hidden"
              >
                <Menu aria-hidden="true" className="h-5 w-5" />
              </button>
              <div className="max-w-md text-center">
                <BrandMark className="mx-auto h-14 w-14 text-[var(--accent-color)]" />
                <h1 className="mt-5 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
                  {t("chat:workspaceReadyTitle")}
                </h1>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--text-muted)]">
                  {t("chat:workspaceReadyDescription")}
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {agents.length > 0 ? (
                    <Button
                      onClick={() =>
                        void createConversation().then((conversation) => {
                          if (!conversation)
                            addToast(t("sidebar:conversationCreateFailed"), "error");
                        })
                      }
                    >
                      <MessageSquarePlus aria-hidden="true" className="h-4 w-4" />
                      {t("sidebar:newChat")}
                    </Button>
                  ) : (
                    <Button onClick={() => setIsSettingsOpen(true)}>
                      <Settings2 aria-hidden="true" className="h-4 w-4" />
                      {t("chat:configureAgent")}
                    </Button>
                  )}
                  <Button variant="secondary" onClick={openSidebar}>
                    <Menu aria-hidden="true" className="h-4 w-4" />
                    {t("chat:browseConversations")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
      {onboardingStatus?.step !== "completed" && <OnboardingFlow />}
      <ToastContainer />
      {isSearchOpen && (
        <Suspense fallback={null}>
          <SearchPanel open onOpenChange={setIsSearchOpen} />
        </Suspense>
      )}
      <AgentSettingsPanel />
      {isSettingsOpen && (
        <Suspense fallback={null}>
          <SettingsPanel open onOpenChange={setIsSettingsOpen} />
        </Suspense>
      )}
    </div>
  );
}
