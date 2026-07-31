import { useCallback, useEffect, useRef, useState } from "react";
import { useChatStore } from "@/store/chatStore";
import { useAgentStore } from "@/store/agentStore";
import { MessageBubble } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";
import { A2AThread } from "./A2AThread";

const BOTTOM_THRESHOLD_PX = 80;

function MessageSkeletons() {
  return (
    <div className="flex flex-col gap-5" aria-label="正在加载消息">
      {["left", "right", "left"].map((side, index) => (
        <div
          key={`${side}-${index}`}
          className={`flex animate-pulse gap-3 ${side === "right" ? "justify-end" : "justify-start"}`}
        >
          {side === "left" && <div className="h-8 w-8 shrink-0 rounded-full bg-gray-800" />}
          <div
            className={`h-16 rounded-2xl bg-gray-800 ${index === 1 ? "w-2/5" : "w-3/5"}`}
          />
        </div>
      ))}
    </div>
  );
}

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const isLoadingMessages = useChatStore((s) => s.isLoadingMessages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const agents = useAgentStore((s) => s.agents);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [showNewMessages, setShowNewMessages] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = scrollRef.current;
    if (!container) return;
    isAtBottomRef.current = true;
    setShowNewMessages(false);
    container.scrollTo({ top: container.scrollHeight, behavior });
  }, []);

  const handleScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottom = distanceFromBottom <= BOTTOM_THRESHOLD_PX;
    isAtBottomRef.current = isAtBottom;
    if (isAtBottom) setShowNewMessages(false);
  };

  useEffect(() => {
    isAtBottomRef.current = true;
    setShowNewMessages(false);
  }, [currentConversationId]);

  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom("auto");
    } else {
      setShowNewMessages(true);
    }
  }, [messages, isStreaming, scrollToBottom]);

  // Group messages by threadId for A2A display
  const rendered: React.ReactNode[] = [];
  const seenThreads = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // If this message is part of an A2A thread, render as A2AThread
    if (msg.threadId && !seenThreads.has(msg.threadId)) {
      seenThreads.add(msg.threadId);
      const threadMessages = messages.filter((m) => m.threadId === msg.threadId);
      rendered.push(
        <A2AThread key={`thread-${msg.threadId}`} messages={threadMessages} />
      );
      continue;
    }

    // Skip messages already rendered inside an A2A thread
    if (msg.threadId && seenThreads.has(msg.threadId)) continue;

    const agent = agents.find((a) => a.id === msg.fromId);
    rendered.push(
      <MessageBubble
        key={msg.id}
        message={msg}
        agentName={agent?.name}
        agentAvatar={agent?.avatar}
      />
    );
  }

  // Show typing indicator when agent is thinking
  if (isStreaming && messages[messages.length - 1]?.fromType === "user") {
    rendered.push(<TypingIndicator key="typing" />);
  }

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-4 md:px-6"
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          {isLoadingMessages && messages.length === 0 ? (
            <MessageSkeletons />
          ) : messages.length === 0 && !isStreaming ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-900 text-indigo-400 ring-1 ring-gray-800">
                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h.01M12 10h.01M16 10h.01M21 12a8 8 0 0 1-8 8 9 9 0 0 1-4-.9L3 21l1.9-5A8 8 0 1 1 21 12Z" />
                </svg>
              </div>
              <p className="mt-4 text-sm font-medium text-gray-300">
                开始你的第一次对话
              </p>
              <p className="mt-1 text-xs text-gray-600">在下方输入消息，和 Agent 打个招呼吧</p>
            </div>
          ) : (
            rendered
          )}
        </div>
      </div>

      {showNewMessages && (
        <button
          type="button"
          onClick={() => scrollToBottom()}
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-indigo-500/40 bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-xl transition-colors hover:bg-indigo-500"
        >
          ↓ 新消息
        </button>
      )}
    </div>
  );
}
