import { useChatStore } from "@/store/chatStore";
import { useAgentStore } from "@/store/agentStore";
import { AgentAvatar } from "@/components/agent/AgentAvatar";

const STATUS_COLORS: Record<string, string> = {
  online: "bg-green-500",
  offline: "bg-gray-500",
  busy: "bg-yellow-500",
  error: "bg-red-500",
};

const STATUS_LABELS: Record<string, string> = {
  online: "在线",
  offline: "离线",
  busy: "忙碌",
  error: "错误",
};

export function Sidebar() {
  const conversations = useChatStore((s) => s.conversations);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const setCurrentConversation = useChatStore((s) => s.setCurrentConversation);
  const agents = useAgentStore((s) => s.agents);

  return (
    <aside className="flex w-72 flex-col border-r border-gray-800 bg-gray-900">
      {/* Logo / Brand */}
      <div className="flex h-14 items-center gap-2 border-b border-gray-800 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold">
          AL
        </div>
        <span className="font-semibold text-gray-100">AgentLink</span>
      </div>

      {/* Conversations */}
      <div className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          会话
        </div>
        <div className="space-y-1">
          {conversations.length === 0 && (
            <p className="px-2 py-4 text-sm text-gray-600">暂无会话</p>
          )}
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setCurrentConversation(conv.id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                currentConversationId === conv.id
                  ? "bg-gray-800 text-gray-100"
                  : "text-gray-400 hover:bg-gray-800/50"
              }`}
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-700 text-sm">
                {conv.type === "dm" ? "💬" : "👥"}
              </div>
              <div className="flex-1 truncate">
                <div className="truncate text-sm font-medium">
                  {conv.title || "未命名会话"}
                </div>
                <div className="truncate text-xs text-gray-600">
                  {new Date(conv.updatedAt).toLocaleString("zh-CN")}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Agent status list */}
      <div className="border-t border-gray-800 px-2 py-3">
        <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-gray-500">
          Agent 状态
        </div>
        <div className="space-y-1">
          {agents.length === 0 && (
            <p className="px-2 py-2 text-sm text-gray-600">暂无 Agent</p>
          )}
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="flex items-center gap-3 rounded-lg px-3 py-2"
            >
              <AgentAvatar name={agent.name} size="sm" />
              <div className="flex-1 truncate">
                <div className="truncate text-sm font-medium text-gray-300">
                  {agent.name}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      STATUS_COLORS[agent.status] ?? STATUS_COLORS.offline
                    }`}
                  />
                  {STATUS_LABELS[agent.status] ?? "未知"}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
