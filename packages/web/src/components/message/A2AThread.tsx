import { useState } from "react";
import { ChevronDown, ClipboardList } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { useAgentStore } from "@/store/agentStore";
import type { Message } from "@/store/chatStore";
import { formatMessageTime } from "@/lib/date";

interface Props {
  messages: Message[];
}

export function A2AThread({ messages }: Props) {
  const { t } = useTranslation("chat");
  const [expanded, setExpanded] = useState(false);
  const agents = useAgentStore((s) => s.agents);

  const getAgentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

  return (
    <div
      data-message-ids={messages.map((message) => message.id).join(" ")}
      className="message-enter rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)]"
    >
      {/* Header — clickable to expand/collapse */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <ClipboardList aria-hidden="true" className="h-4 w-4 text-[var(--text-tertiary)]" />
        <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">
          {t("a2aChain")}
        </span>
        <span className="text-xs text-[var(--text-tertiary)]">
          {t("a2aMessages", { count: messages.length })}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 text-[var(--text-tertiary)] transition-transform ${
            expanded ? "rotate-180" : ""
          }`}
        />
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
                        <span className="font-medium text-[var(--text-primary)]">{toName}</span>
                      </>
                    )}
                  </div>
                  <div className="mt-0.5 rounded-lg bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--text-primary)]">
                    {msg.content}
                  </div>
                </div>
                <span className="text-[10px] text-[var(--text-muted)]">
                  {formatMessageTime(msg.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
