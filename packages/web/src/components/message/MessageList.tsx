import { useRef, useEffect } from "react";
import { useChatStore } from "@/store/chatStore";
import { useAgentStore } from "@/store/agentStore";
import { MessageBubble } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";
import { A2AThread } from "./A2AThread";

export function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const agents = useAgentStore((s) => s.agents);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
    <div className="h-full overflow-y-auto px-6 py-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-1 items-center justify-center py-20">
            <p className="text-sm text-gray-600">
              开始和 Agent 对话吧 🚀
            </p>
          </div>
        )}
        {rendered}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
