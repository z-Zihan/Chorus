import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronDown, MessageSquare, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatStore, type Message } from "@/store/chatStore";
import { useAgentStore } from "@/store/agentStore";
import { MessageBubble } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";
import { TaskTrackingCard } from "./TaskTrackingCard";
import { A2AForwardingCard } from "./A2AForwardingCard";

const BOTTOM_THRESHOLD_PX = 80;
const SCROLL_DEBOUNCE_MS = 100;

function isA2AMessage(message: Message) {
  return message.fromType === "agent" && message.toType === "agent";
}

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
            className={`h-16 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] ${index === 1 ? "w-2/5" : "w-3/5"}`}
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
  const messagesError = useChatStore((s) => s.messagesError);
  const fetchMessages = useChatStore((s) => s.fetchMessages);
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
  const isFirstRenderForConversationRef = useRef(true);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const isGroupConversation =
    [...conversations, ...groupConversations, ...archivedConversations].find(
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
    isFirstRenderForConversationRef.current = true;
    setShowNewMessages(false);
  }, [currentConversationId]);

  useEffect(() => {
    if (isLoadingMessages) return;

    if (isFirstRenderForConversationRef.current) {
      isFirstRenderForConversationRef.current = false;
      scrollToBottom("auto");
      return;
    }

    if (isAtBottomRef.current) {
      const timeout = window.setTimeout(() => scrollToBottom("smooth"), SCROLL_DEBOUNCE_MS);
      return () => window.clearTimeout(timeout);
    } else {
      setShowNewMessages(true);
    }
  }, [messages, a2aThreads, isStreaming, isLoadingMessages, currentConversationId, scrollToBottom]);

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

  // Resolve every A2A message to the normal message that started its thread.
  const messagesById = new Map(messages.map((message) => [message.id, message]));
  const parentIdByThread = new Map<string, string>();

  for (const thread of Object.values(a2aThreads)) {
    if (thread.parentMessageId) parentIdByThread.set(thread.threadId, thread.parentMessageId);
  }

  for (const message of messages) {
    if (message.threadId && !isA2AMessage(message)) {
      parentIdByThread.set(message.threadId, message.id);
    }
    if (!isA2AMessage(message) || !message.threadId || !message.parentId) continue;
    const parent = messagesById.get(message.parentId);
    if (parent && !isA2AMessage(parent)) {
      parentIdByThread.set(message.threadId, parent.id);
    }
  }

  const findParentId = (message: Message) => {
    let candidateId = message.parentId;
    const visited = new Set<string>();

    while (candidateId && !visited.has(candidateId)) {
      visited.add(candidateId);
      const candidate = messagesById.get(candidateId);
      if (!candidate) break;
      if (!isA2AMessage(candidate)) return candidate.id;
      candidateId = candidate.parentId;
    }

    return message.threadId ? parentIdByThread.get(message.threadId) : undefined;
  };

  const repliesByParentId = new Map<string, Message[]>();
  for (const message of messages) {
    if (!isA2AMessage(message)) continue;
    const parentId = findParentId(message);
    if (!parentId) continue;
    const parent = messagesById.get(parentId);
    if (!parent || isA2AMessage(parent)) continue;
    const replies = repliesByParentId.get(parentId) ?? [];
    replies.push(message);
    repliesByParentId.set(parentId, replies);
  }

  const rendered: React.ReactNode[] = [];
  const seenThreads = new Set<string>();
  const threadStates = Object.values(a2aThreads);
  let previousTopLevelMessage: Message | undefined;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // A2A messages are rendered only as replies nested below their parent.
    if (isA2AMessage(msg)) continue;

    const agent = agents.find((a) => a.id === msg.fromId);
    const isFirstFromAgent =
      !previousTopLevelMessage ||
      previousTopLevelMessage.fromId !== msg.fromId ||
      previousTopLevelMessage.fromType !== msg.fromType;
    const replies = repliesByParentId.get(msg.id) ?? [];
    const attachedThreads =
      msg.fromType === "agent"
        ? threadStates.filter(
            (thread) => thread.parentMessageId === msg.id && !seenThreads.has(thread.threadId),
          )
        : [];

    for (const thread of attachedThreads) seenThreads.add(thread.threadId);

    rendered.push(
      <div key={msg.id} className="space-y-2">
        <MessageBubble
          message={msg}
          agentName={isGroupConversation ? (agent?.name ?? msg.fromId) : agent?.name}
          agentAvatar={agent?.avatar}
          isGroup={isGroupConversation}
          showHeader={isFirstFromAgent}
        />
        {replies.length > 0 && (
          <div className="ml-7 max-w-2xl space-y-1.5 md:ml-11">
            {replies.map((reply) => {
              const fromAgent = agents.find((item) => item.id === reply.fromId);
              return (
                <A2AForwardingCard
                  key={reply.id}
                  message={reply}
                  fromAgent={{
                    name: fromAgent?.name ?? reply.fromId,
                    avatar: fromAgent?.avatar,
                  }}
                />
              );
            })}
          </div>
        )}
        {attachedThreads.map((thread) => (
          <div key={`task-${thread.threadId}`} className="ml-11 max-w-2xl">
            <TaskTrackingCard thread={thread} />
          </div>
        ))}
      </div>,
    );
    previousTopLevelMessage = msg;
  }

  // Calls without an available parent message remain visible as standalone cards.
  for (const thread of threadStates) {
    if (seenThreads.has(thread.threadId)) continue;
    seenThreads.add(thread.threadId);
    rendered.push(<TaskTrackingCard key={`task-${thread.threadId}`} thread={thread} />);
  }

  // Show typing indicator when agent is thinking
  if (isStreaming && messages[messages.length - 1]?.fromType === "user") {
    // Find which agent is responding

    const lastUserMsg = messages[messages.length - 1];
    const targetAgentId = lastUserMsg?.metadata?.agentId as string | undefined;
    const agent = agents.find((a) => a.id === targetAgentId) ?? agents[0];
    rendered.push(<TypingIndicator key="typing" agentName={agent?.name} />);
  }

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        className="h-full overflow-y-auto px-4 py-5 md:px-8"
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          {messagesError && messages.length > 0 && (
            <div
              role="alert"
              className="flex items-center gap-3 rounded-xl border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 px-3 py-2.5"
            >
              <AlertCircle
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-[var(--status-error)]"
              />
              <p className="min-w-0 flex-1 text-xs text-[var(--text-secondary)]">
                {t("messageLoadFailed")}
              </p>
              <button
                type="button"
                onClick={() => currentConversationId && void fetchMessages(currentConversationId)}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-[var(--accent-hover)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)]"
              >
                {t("retry")}
              </button>
            </div>
          )}
          {isLoadingMessages && messages.length === 0 ? (
            <MessageSkeletons label={t("loadingMessages")} />
          ) : messagesError && messages.length === 0 ? (
            <div
              role="alert"
              className="flex flex-col items-center justify-center py-24 text-center"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--status-error)]/10 text-[var(--status-error)] ring-1 ring-[var(--status-error)]/20">
                <AlertCircle aria-hidden="true" className="h-7 w-7" />
              </div>
              <p className="mt-4 text-sm font-medium text-[var(--text-primary)]">
                {t("messageLoadFailedTitle")}
              </p>
              <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--text-muted)]">
                {t("messageLoadFailed")}
              </p>
              <button
                type="button"
                onClick={() => currentConversationId && void fetchMessages(currentConversationId)}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--accent-color)] px-3 py-2 text-sm font-medium text-[var(--accent-foreground)] hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)] focus-visible:ring-offset-2"
              >
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                {t("retry")}
              </button>
            </div>
          ) : messages.length === 0 && Object.keys(a2aThreads).length === 0 && !isStreaming ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-tertiary)]">
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
          className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] shadow-[var(--shadow-pop)] transition-colors hover:bg-[var(--bg-hover)]"
        >
          <ChevronDown
            aria-hidden="true"
            className="mr-1 inline h-4 w-4 text-[var(--accent-color)]"
          />
          {t("newMessages")}
        </button>
      )}
    </div>
  );
}
