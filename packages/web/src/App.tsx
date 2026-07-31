import { useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { ChatArea } from "@/components/layout/ChatArea";
import { useChatStore } from "@/store/chatStore";
import { useAgentStore } from "@/store/agentStore";
import { useWebSocket } from "@/hooks/useWebSocket";

export default function App() {
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const fetchConversations = useChatStore((s) => s.fetchConversations);

  useWebSocket();

  // Init: load agents & conversations on mount
  useEffect(() => {
    fetchAgents();
    fetchConversations();
  }, [fetchAgents, fetchConversations]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950 text-gray-100">
      {/* Left sidebar — conversations + agent status */}
      <Sidebar />

      {/* Main chat area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {currentConversationId ? (
          <ChatArea />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <h1 className="mb-2 text-2xl font-semibold text-gray-400">
                AgentLink
              </h1>
              <p className="text-sm text-gray-600">
                选择一个会话开始对话
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
