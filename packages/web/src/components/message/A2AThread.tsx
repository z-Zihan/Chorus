import { useEffect, useState } from "react";
import {
  ArrowRight,
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
  const [expanded, setExpanded] = useState(thread?.status === "running");
  const agents = useAgentStore((s) => s.agents);
  const cancelA2AThread = useChatStore((s) => s.cancelA2AThread);

  const getAgentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const responseMessages = messages.filter((message) => message.metadata?.a2aType === "response");
  const detailMessages =
    messages.length > 0
      ? messages
      : thread
        ? [
            {
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
            },
          ]
        : [];
  const firstMessage = detailMessages[0];
  const fromId = thread?.from ?? firstMessage?.fromId;
  const toId = thread?.to ?? firstMessage?.toId;
  const fromAgent = agents.find((agent) => agent.id === fromId);
  const toAgent = agents.find((agent) => agent.id === toId);
  const transportStatus = thread?.delivery?.transport;
  const executionStatus = thread?.delivery?.execution;

  useEffect(() => {
    if (thread) setExpanded(thread.status === "running");
  }, [thread]);

  return (
    <div
      data-message-ids={messages.map((message) => message.id).join(" ")}
      className="message-enter rounded-r-lg border-l-2 border-l-[var(--accent-color)] bg-[var(--bg-elevated)]/50"
    >
      <div className="flex items-center gap-2 pr-3">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2.5 text-left"
          aria-expanded={expanded}
        >
          <ClipboardList
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-[var(--accent-hover)]"
          />
          {fromId && toId && (
            <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
              <AgentAvatar name={fromAgent?.name ?? fromId} src={fromAgent?.avatar} size="xs" />
              <ArrowRight aria-hidden="true" className="h-3 w-3 text-[var(--text-muted)]" />
              <AgentAvatar name={toAgent?.name ?? toId} src={toAgent?.avatar} size="xs" />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-primary)]">
            {t("a2aChain")}
          </span>
          {thread?.status === "running" && (
            <span className="flex items-center gap-1 text-xs text-[var(--status-busy)]">
              <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
              <span className="hidden sm:inline">{t("a2aRunning")}</span>
            </span>
          )}
          {thread?.status === "completed" && (
            <span className="flex items-center gap-1 text-xs text-[var(--status-online)]">
              <CircleCheck aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("a2aCompleted")}</span>
            </span>
          )}
          {thread?.status === "error" && (
            <span className="flex items-center gap-1 text-xs text-[var(--status-error)]">
              <CircleAlert aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("a2aFailed")}</span>
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
            <span className="hidden sm:inline">{t("a2aCancel")}</span>
          </button>
        )}
      </div>

      {expanded && (
        <div className="space-y-2 border-t border-[var(--border-color)]/70 px-4 py-3">
          {thread?.delivery && (
            <div
              className="flex flex-wrap gap-2 rounded-lg bg-[var(--bg-base)]/70 px-3 py-2 text-xs"
              aria-live="polite"
            >
              {transportStatus && (
                <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                  <span>{t("hubDelivery.transport")}</span>
                  <span
                    className={
                      transportStatus === "failed"
                        ? "text-[var(--status-error)]"
                        : transportStatus === "queued"
                          ? "text-[var(--status-busy)]"
                          : "text-[var(--status-online)]"
                    }
                  >
                    {t(`hubDelivery.transportStatus.${transportStatus}`)}
                  </span>
                </span>
              )}
              {executionStatus && (
                <span className="flex items-center gap-1.5 border-l border-[var(--border-color)] pl-2 text-[var(--text-secondary)]">
                  <span>{t("hubDelivery.execution")}</span>
                  <span
                    className={
                      ["denied", "error"].includes(executionStatus)
                        ? "text-[var(--status-error)]"
                        : executionStatus === "accepted"
                          ? "text-[var(--status-busy)]"
                          : "text-[var(--status-online)]"
                    }
                  >
                    {t(`hubDelivery.executionStatus.${executionStatus}`)}
                  </span>
                </span>
              )}
            </div>
          )}
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
