import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { useAgentStore } from "@/store/agentStore";
import type { Message } from "@/store/chatStore";

interface Props {
  messages: Message[];
}

export function A2AThread({ messages }: Props) {
  const { t, i18n } = useTranslation("chat");
  const [expanded, setExpanded] = useState(false);
  const agents = useAgentStore((s) => s.agents);

  const getAgentName = (id: string) =>
    agents.find((a) => a.id === id)?.name ?? id;

  return (
    <div className="message-enter rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)]">
      {/* Header — clickable to expand/collapse */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <span className="text-sm">📋</span>
        <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">
          {t("a2aChain")}
        </span>
        <span className="text-xs text-[var(--text-tertiary)]">
          {t("a2aMessages", { count: messages.length })}
        </span>
        <svg
          className={`h-4 w-4 text-[var(--text-tertiary)] transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Expanded: show each A2A message */}
      {expanded && (
        <div className="space-y-2 border-t border-[var(--border-color)] px-4 py-3">
          {messages.map((msg) => {
            const fromName = getAgentName(msg.fromId);
            const toName = msg.toId ? getAgentName(msg.toId) : null;

            return (
              <div key={msg.id} className="flex items-start gap-2.5">
                <AgentAvatar name={fromName} size="xs" />
                <div className="flex-1">
                  <div className="text-xs text-[var(--text-tertiary)]">
                    <span className="font-medium text-[var(--text-primary)]">{fromName}</span>
                    {toName && (
                      <>
                        {" → "}
                        <span className="font-medium text-[var(--text-primary)]">
                          {toName}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="mt-0.5 rounded-lg bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--text-primary)]">
                    {msg.content}
                  </div>
                </div>
                <span className="text-[10px] text-[var(--text-muted)]">
                  {new Date(msg.timestamp).toLocaleTimeString(i18n.resolvedLanguage, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
