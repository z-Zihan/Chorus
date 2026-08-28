import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { voiceColor } from "@/lib/agentColor";
import type { Message } from "@/store/chatStore";

interface AgentIdentity {
  name: string;
  avatar?: string;
}

interface Props {
  message: Message;
  fromAgent: AgentIdentity;
}

export function A2AForwardingCard({ message, fromAgent }: Props) {
  return (
    <div
      data-message-id={message.id}
      className="message-enter relative ml-4 rounded-r-xl border border-[var(--border-subtle)] border-l-2 bg-[var(--bg-surface)]/60 py-2 pl-3 pr-3"
      style={{ borderLeftColor: voiceColor(fromAgent.name) }}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 h-5 w-5 shrink-0 [&>*]:h-5 [&>*]:w-5">
          <AgentAvatar name={fromAgent.name} src={fromAgent.avatar} size="xs" />
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="mono text-[11px] font-medium tracking-wide"
            style={{ color: voiceColor(fromAgent.name) }}
          >
            {fromAgent.name}
          </div>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--text-primary)]">
            {message.content}
          </p>
        </div>
      </div>
    </div>
  );
}
