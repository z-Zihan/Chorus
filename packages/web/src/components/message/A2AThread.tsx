import { useState } from "react";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { useAgentStore } from "@/store/agentStore";
import type { Message } from "@/store/chatStore";

interface Props {
  messages: Message[];
}

export function A2AThread({ messages }: Props) {
  const [expanded, setExpanded] = useState(false);
  const agents = useAgentStore((s) => s.agents);

  const getAgentName = (id: string) =>
    agents.find((a) => a.id === id)?.name ?? id;

  return (
    <div className="message-enter rounded-xl border border-gray-700/50 bg-gray-900/60">
      {/* Header — clickable to expand/collapse */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <span className="text-sm">📋</span>
        <span className="flex-1 text-sm font-medium text-gray-300">
          A2A 调用链
        </span>
        <span className="text-xs text-gray-500">
          {messages.length} 条消息
        </span>
        <svg
          className={`h-4 w-4 text-gray-500 transition-transform ${
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
        <div className="space-y-2 border-t border-gray-800 px-4 py-3">
          {messages.map((msg) => {
            const fromName = getAgentName(msg.fromId);
            const toName = msg.toId ? getAgentName(msg.toId) : null;

            return (
              <div key={msg.id} className="flex items-start gap-2.5">
                <AgentAvatar name={fromName} size="xs" />
                <div className="flex-1">
                  <div className="text-xs text-gray-500">
                    <span className="font-medium text-gray-300">{fromName}</span>
                    {toName && (
                      <>
                        {" → "}
                        <span className="font-medium text-gray-300">
                          {toName}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="mt-0.5 rounded-lg bg-gray-800/60 px-3 py-1.5 text-sm text-gray-300">
                    {msg.content}
                  </div>
                </div>
                <span className="text-[10px] text-gray-600">
                  {new Date(msg.timestamp).toLocaleTimeString("zh-CN", {
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
