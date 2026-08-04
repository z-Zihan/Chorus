import { useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import type { Message } from "@/store/chatStore";

interface AgentIdentity {
  name: string;
  avatar?: string;
}

interface Props {
  message: Message;
  fromAgent: AgentIdentity;
  toAgent: AgentIdentity;
}

export function A2AForwardingCard({ message, fromAgent, toAgent }: Props) {
  const { t } = useTranslation("chat");
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      data-message-id={message.id}
      className="message-enter mx-auto w-full max-w-2xl rounded-lg bg-[var(--bg-elevated)]/70 text-[var(--text-secondary)]"
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left outline-none transition-colors hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-color)]"
        aria-expanded={expanded}
      >
        <AgentAvatar name={fromAgent.name} src={fromAgent.avatar} size="xs" />
        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
        <AgentAvatar name={toAgent.name} src={toAgent.avatar} size="xs" />
        <span className="min-w-0 flex-1 truncate text-xs">
          <span className="font-medium text-[var(--text-primary)]">{fromAgent.name}</span>
          <span aria-hidden="true"> → </span>
          <span className="font-medium text-[var(--text-primary)]">{toAgent.name}</span>
          <span> · {t("a2aForwardedMessage")}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded && (
        <div className="border-t border-[var(--border-color)]/70 px-3 py-2.5 text-sm leading-6 text-[var(--text-primary)]">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      )}
    </div>
  );
}
