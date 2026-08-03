import { AgentAvatar } from "@/components/agent/AgentAvatar";

interface TypingIndicatorProps {
  agentName?: string;

}

export function TypingIndicator({ agentName }: TypingIndicatorProps) {
  return (
    <div className="flex gap-3 message-enter">
      <div className="mt-0.5 flex-shrink-0">
        <AgentAvatar name={agentName ?? "Agent"} size="sm" />
      </div>
      <div className="flex flex-col gap-1">
        {agentName && (
          <span className="text-xs text-[var(--text-tertiary)]">{agentName}</span>
        )}
        <div className="flex items-center gap-1.5 rounded-2xl bg-[var(--bg-elevated)] px-4 py-3.5">
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--text-secondary)]" />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--text-secondary)]" />
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-[var(--text-secondary)]" />
        </div>
      </div>
    </div>
  );
}
