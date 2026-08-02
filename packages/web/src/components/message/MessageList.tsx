import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "@/store/chatStore";
import { useAgentStore } from "@/store/agentStore";
import { MessageBubble } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";
import { A2AThread } from "./A2AThread";
import { TaskTrackingCard } from "./TaskTrackingCard";

const BOTTOM_THRESHOLD_PX = 80;

function MessageSkeletons({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-5" aria-label={label}>
      {["left", "right", "left"].map((side, index) => (
        <div
          key={`${side}-${index}`}
          className={`flex animate-pulse gap-3 ${side === "right" ? "justify-end" : "justify-start"}`}
        >
          {side === "left" && (
            <div className="h-8 w-8 shrink-0 rounded-full bg-[var(--bg-elevated)]" />
          )}
          <div
            className={`h-16 rounded-2xl bg-[var(--bg-elevated)] ${index === 1 ? "w-2/5" : "w-3/5"}`}
          />
        </div>
      ))}
    </div>
  );
}

export function MessageList() {
  const { t } = useTranslation("chat");
  const messages = useChatStore((s) => s.messages);
  const a2aThreads = useChatStore((s) => s.a2aThreads);
  const isLoadingMessages = useChatStore((s) => s.isLoadingMessages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const groupConversations = useChatStore((s) => s.groupConversations);
  const archivedConversations = useChatStore((s) => s.archivedConversations);
  const targetMessageId = useChatStore((s) => s.targetMessageId);
  const clearTargetMessage = useChatStore((s) => s.clearTargetMessage);
  const agents = useAgentStore((s) => s.agents);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const isGroupConversation = [...conversations, ...groupConversations, ...archivedConversations].find(
    (conversation) => conversation.id === currentConversationId,
  )?.type === "group";

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
  }, [messages, a2aThreads, isStreaming, scrollToBottom]);

  useEffect(() => {
    if (!targetMessageId || isLoadingMessages) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-message-id="${targetMessageId}"], [data-message-ids~="${targetMessageId}"]`,
      );
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      clearTargetMessage();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [targetMessageId, isLoadingMessages, messages, clearTargetMessage]);

  // Group messages by threadId for A2A display
  const rendered: React.ReactNode[] = [];
  const seenThreads = new Set<string>();
  const threadStates = Object.values(a2aThreads);

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Live A2A messages are represented by their task card.
    if (msg.threadId && a2aThreads[msg.threadId]) {
      continue;
    }

    // Keep the legacy grouped display for persisted A2A messages without live state.
    if (msg.threadId && !seenThreads.has(msg.threadId)) {
      seenThreads.add(msg.threadId);
      const threadMessages = messages.filter((m) => m.threadId === msg.threadId);
      rendered.push(
        <A2AThread
          key={`thread-${msg.threadId}`}
          messages={threadMessages}
          thread={a2aThreads[msg.threadId]}
        />,
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
        agentName={isGroupConversation ? agent?.name ?? msg.fromId : agent?.name}
        agentAvatar={agent?.avatar}
        isGroup={isGroupConversation}
      />,
    );

    if (msg.fromType === "agent") {
      for (const thread of threadStates) {
        if (thread.parentMessageId !== msg.id || seenThreads.has(thread.threadId)) continue;
        seenThreads.add(thread.threadId);
        rendered.push(<TaskTrackingCard key={`task-${thread.threadId}`} thread={thread} />);
      }
    }
  }

  // Calls without an available parent message remain visible as standalone cards.
  for (const thread of threadStates) {
    if (seenThreads.has(thread.threadId)) continue;
    seenThreads.add(thread.threadId);
    rendered.push(<TaskTrackingCard key={`task-${thread.threadId}`} thread={thread} />);
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
        role="log"
        aria-live="polite"
        className="h-full overflow-y-auto px-4 py-4 md:px-6"
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          {isLoadingMessages && messages.length === 0 ? (
            <MessageSkeletons label={t("loadingMessages")} />
          ) : messages.length === 0 && Object.keys(a2aThreads).length === 0 && !isStreaming ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--bg-surface)] text-[var(--accent-hover)] ring-1 ring-[var(--border-color)]">
                <MessageSquare aria-hidden="true" className="h-7 w-7" />
              </div>
              <p className="mt-4 text-sm font-medium text-[var(--text-primary)]">
                {t("emptyTitle")}
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{t("emptyDescription")}</p>
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
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[var(--accent-hover)] bg-[var(--accent-color)] px-4 py-2 text-sm font-medium text-white shadow-xl transition-colors hover:bg-[var(--accent-hover)]"
        >
          <ChevronDown aria-hidden="true" className="mr-1 inline h-4 w-4" />
          {t("newMessages")}
        </button>
      )}
    </div>
  );
}
