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
  const [expanded, setExpanded] = useState(thread.status === "running");
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
    setExpanded(thread.status === "running");
  }, [thread.status]);

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
      className="message-enter ml-4 overflow-hidden rounded-r-xl border-l-2 border-l-[var(--accent-color)] bg-[var(--bg-elevated)]/50"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
        aria-expanded={expanded}
        aria-label={`${statusLabel}: ${toName}`}
      >
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="h-5 w-5 [&>*]:h-5 [&>*]:w-5">
            <AgentAvatar name={fromName} src={fromAgent?.avatar} size="xs" />
          </div>
          <span aria-hidden="true" className="text-[10px] text-[var(--text-muted)]">
            →
          </span>
          <div className="h-5 w-5 [&>*]:h-5 [&>*]:w-5">
            <AgentAvatar name={toName} src={toAgent?.avatar} size="xs" />
          </div>
        </div>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--accent-hover)]">
          {fromName} → {toName}
        </span>
        {thread.status === "running" && (
          <LoaderCircle
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--status-busy)]"
          />
        )}
        {thread.status === "completed" && (
          <CircleCheck
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-[var(--status-online)]"
          />
        )}
        {thread.status === "error" && (
          <CircleAlert
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-[var(--status-error)]"
          />
        )}
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
        <div className="space-y-2 border-t border-[var(--border-color)]/70 px-3 py-2.5">
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
