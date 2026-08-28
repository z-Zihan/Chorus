import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { voiceColor } from "@/lib/agentColor";

interface TypingIndicatorProps {
  agentName?: string;
}

export function TypingIndicator({ agentName }: TypingIndicatorProps) {
  const name = agentName ?? "Agent";
  return (
    <div className="flex gap-3 message-enter">
      <div className="mt-0.5 flex-shrink-0">
        <AgentAvatar name={name} size="sm" />
      </div>
      <div className="flex flex-col gap-1">
        {agentName && (
          <span
            className="mono text-[11px] font-medium tracking-wide"
            style={{ color: voiceColor(name) }}
          >
            {agentName}
          </span>
        )}
        <div className="flex w-16 items-center justify-center gap-1.5 rounded-2xl rounded-tl-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--accent-warm)]" />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--accent-warm)]" />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--accent-warm)]" />
        </div>
      </div>
    </div>
  );
}
