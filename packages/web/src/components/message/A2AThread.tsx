import { useState } from "react";
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  LoaderCircle,
  Square,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { useAgentStore } from "@/store/agentStore";
import { useChatStore, type A2AThreadState, type Message } from "@/store/chatStore";
import { formatMessageTime } from "@/lib/date";

interface Props {
  messages: Message[];
  thread?: A2AThreadState;
}

export function A2AThread({ messages, thread }: Props) {
  const { t } = useTranslation("chat");
  const [expanded, setExpanded] = useState(false);
  const agents = useAgentStore((s) => s.agents);
  const cancelA2AThread = useChatStore((s) => s.cancelA2AThread);

  const getAgentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const responseMessages = messages.filter((message) => message.metadata?.a2aType === "response");
  const detailMessages = messages.length > 0
    ? messages
    : thread
      ? [{
          id: `a2a-live-${thread.threadId}`,
          conversationId: thread.conversationId,
          fromType: "agent" as const,
          fromId: thread.from,
          toType: "agent" as const,
          toId: thread.to,
          content: thread.message,
          timestamp: thread.startedAt,
          threadId: thread.threadId,
          status: "done" as const,
        }]
      : [];

  return (
    <div
      data-message-ids={messages.map((message) => message.id).join(" ")}
      className="message-enter rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)]"
    >
      <div className="flex items-center gap-2 pr-3">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2.5 text-left"
          aria-expanded={expanded}
        >
          <ClipboardList aria-hidden="true" className="h-4 w-4 text-[var(--text-tertiary)]" />
          <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">
            {t("a2aChain")}
          </span>
          {thread?.status === "running" && (
            <span className="flex items-center gap-1 text-xs text-[var(--status-busy)]">
              <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
              {t("a2aRunning")}
            </span>
          )}
          {thread?.status === "completed" && (
            <span className="flex items-center gap-1 text-xs text-[var(--status-online)]">
              <CircleCheck aria-hidden="true" className="h-3.5 w-3.5" />
              {t("a2aCompleted")}
            </span>
          )}
          {thread?.status === "error" && (
            <span className="flex items-center gap-1 text-xs text-[var(--status-error)]">
              <CircleAlert aria-hidden="true" className="h-3.5 w-3.5" />
              {t("a2aFailed")}
            </span>
          )}
          {!thread && (
            <span className="text-xs text-[var(--text-tertiary)]">
              {t("a2aMessages", { count: messages.length })}
            </span>
          )}
          <ChevronDown
            aria-hidden="true"
            className={`h-4 w-4 text-[var(--text-tertiary)] transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </button>
        {thread?.status === "running" && (
          <button
            type="button"
            onClick={() => cancelA2AThread(thread.threadId)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--status-error)] hover:bg-[var(--bg-hover)]"
            aria-label={t("a2aCancel")}
          >
            <Square aria-hidden="true" className="h-3 w-3 fill-current" />
            {t("a2aCancel")}
          </button>
        )}
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-[var(--border-color)] px-4 py-3">
          {detailMessages.map((msg) => {
            const fromName = getAgentName(msg.fromId);
            const toName = msg.toId ? getAgentName(msg.toId) : null;

            return (
              <div key={msg.id} className="flex items-start gap-2.5">
                <AgentAvatar name={fromName} size="xs" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-[var(--text-tertiary)]">
                    <span className="font-medium text-[var(--text-primary)]">{fromName}</span>
                    {toName && (
                      <>
                        {" → "}
                        <span className="font-medium text-[var(--text-primary)]">{toName}</span>
                      </>
                    )}
                  </div>
                  <div className="mt-0.5 whitespace-pre-wrap rounded-lg bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--text-primary)]">
                    {msg.content}
                  </div>
                </div>
                <span className="text-[10px] text-[var(--text-muted)]">
                  {formatMessageTime(msg.timestamp)}
                </span>
              </div>
            );
          })}
          {thread?.status === "completed" && thread.result && responseMessages.length === 0 && (
            <div className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)]">
              {thread.result}
            </div>
          )}
          {thread?.status === "error" && thread.error && responseMessages.length === 0 && (
            <div className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--status-error)]">
              {thread.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
