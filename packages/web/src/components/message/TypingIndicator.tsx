import { AgentAvatar } from "@/components/agent/AgentAvatar";

export function TypingIndicator() {
  return (
    <div className="flex gap-3 message-enter">
      <div className="mt-0.5 flex-shrink-0">
        <AgentAvatar name="Agent" size="sm" />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl bg-gray-800 px-4 py-3.5">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gray-400" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gray-400" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gray-400" />
      </div>
    </div>
  );
}
