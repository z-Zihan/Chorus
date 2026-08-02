import { useEffect, useState } from "react";
import { ChevronDown, CircleAlert, CircleCheck, ExternalLink, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { useAgentStore } from "@/store/agentStore";
import { useChatStore, type A2AThreadState } from "@/store/chatStore";

interface Props {
  thread: A2AThreadState;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const parts = hours > 0 ? [hours, minutes, seconds] : [minutes, seconds];
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}

export function TaskTrackingCard({ thread }: Props) {
  const { t } = useTranslation("chat");
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const agents = useAgentStore((state) => state.agents);
  const navigateToConversation = useChatStore((state) => state.navigateToConversation);
  const hasGroupConversation = useChatStore(
    (state) =>
      state.groupConversations.some((conversation) => conversation.id === thread.conversationId) ||
      state.archivedConversations.some(
        (conversation) =>
          conversation.id === thread.conversationId && conversation.type === "group",
      ),
  );

  useEffect(() => {
    if (thread.status !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [thread.status, thread.startedAt]);

  const fromAgent = agents.find((agent) => agent.id === thread.from);
  const toAgent = agents.find((agent) => agent.id === thread.to);
  const fromName = fromAgent?.name ?? thread.from;
  const toName = toAgent?.name ?? thread.to;
  const endedAt = thread.status === "running" ? now : (thread.completedAt ?? now);
  const duration = formatDuration(endedAt - thread.startedAt);
  const statusLabel =
    thread.status === "running"
      ? t("taskRunning")
      : thread.status === "completed"
        ? t("taskCompleted")
        : t("taskFailed");

  return (
    <div
      data-thread-id={thread.threadId}
      className="message-enter overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)]"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full min-w-0 items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
        aria-expanded={expanded}
        aria-label={`${statusLabel}: ${toName}`}
      >
        {thread.status === "running" && (
          <LoaderCircle
            aria-hidden="true"
            className="h-4 w-4 shrink-0 animate-spin text-[var(--status-busy)]"
          />
        )}
        {thread.status === "completed" && (
          <CircleCheck
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-[var(--status-online)]"
          />
        )}
        {thread.status === "error" && (
          <CircleAlert aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--status-error)]" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text-primary)]">
          {toName}
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--text-tertiary)]">
          {duration}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-[var(--border-color)] px-4 py-3">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span
              className={
                thread.status === "running"
                  ? "text-[var(--status-busy)]"
                  : thread.status === "completed"
                    ? "text-[var(--status-online)]"
                    : "text-[var(--status-error)]"
              }
            >
              {statusLabel}
            </span>
            <span className="text-[var(--text-tertiary)]">{t("taskDuration", { duration })}</span>
          </div>

          <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
            <AgentAvatar name={fromName} src={fromAgent?.avatar} size="xs" />
            <span className="font-medium text-[var(--text-primary)]">{fromName}</span>
            <span aria-hidden="true">→</span>
            <AgentAvatar name={toName} src={toAgent?.avatar} size="xs" />
            <span className="font-medium text-[var(--text-primary)]">{toName}</span>
          </div>

          <div className="whitespace-pre-wrap rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)]">
            {thread.message}
          </div>

          {thread.status === "completed" && thread.result && (
            <div className="whitespace-pre-wrap rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--text-primary)]">
              {thread.result}
            </div>
          )}

          {thread.status === "error" && thread.error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--status-error)]"
            >
              <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="whitespace-pre-wrap">{thread.error}</span>
            </div>
          )}

          {thread.status === "completed" && hasGroupConversation && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => navigateToConversation(thread.conversationId)}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--accent-hover)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                {t("jumpToSource")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
