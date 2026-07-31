import { MessageList } from "@/components/message/MessageList";
import { InputBar } from "@/components/layout/InputBar";
import { useChatStore } from "@/store/chatStore";

export function ChatArea() {
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const currentConv = conversations.find((c) => c.id === currentConversationId);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-14 items-center border-b border-gray-800 px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-700 text-sm">
            {currentConv?.type === "dm" ? "💬" : "👥"}
          </div>
          <h2 className="font-semibold text-gray-100">
            {currentConv?.title ?? "私聊: 我的 Agent"}
          </h2>
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
