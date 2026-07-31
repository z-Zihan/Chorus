import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import type { Message } from "@/store/chatStore";

interface Props {
  message: Message;
  agentName?: string;
  agentAvatar?: string;
}

export function MessageBubble({ message, agentName, agentAvatar }: Props) {
  const isUser = message.fromType === "user";
  const isError = message.status === "error";
  const isPartial = message.status === "partial";
  const isStreaming = message.status === "streaming";

  // System message — centered gray text
  if (message.fromType === "agent" && message.content.startsWith("[system]")) {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-gray-800/50 px-3 py-1 text-xs text-gray-500">
          {message.content.replace("[system]", "").trim()}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`flex gap-3 message-enter ${
        isUser ? "flex-row-reverse" : "flex-row"
      }`}
    >
      {/* Avatar */}
      {!isUser && (
        <div className="mt-0.5 flex-shrink-0">
          <AgentAvatar name={agentName ?? "Agent"} src={agentAvatar} size="sm" />
        </div>
      )}

      {/* Bubble */}
      <div
        className={`group relative max-w-[75%] rounded-2xl px-4 py-2.5 ${
          isUser
            ? "bg-indigo-600 text-white"
            : isError
            ? "bg-red-900/40 border border-red-700/50 text-red-200"
            : "bg-gray-800 text-gray-100"
        }`}
      >
        {/* Agent name label */}
        {!isUser && agentName && (
          <div className="mb-1 text-xs font-medium text-indigo-400">
            {agentName}
          </div>
        )}

        {/* Content */}
        <div
          className={`text-sm leading-relaxed ${
            isStreaming ? "typing-cursor" : ""
          }`}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre: ({ children }) => (
                <pre className="my-2 overflow-x-auto rounded-lg bg-gray-950/80 p-3 text-xs">
                  {children}
                </pre>
              ),
              code: ({ inline, children }) =>
                inline ? (
                  <code className="rounded bg-gray-700/60 px-1 py-0.5 text-xs">
                    {children}
                  </code>
                ) : (
                  <code>{children}</code>
                ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 underline hover:text-indigo-300"
                >
                  {children}
                </a>
              ),
              // Fix type mismatch with react-markdown v9
              // @ts-expect-error - inline prop exists at runtime
            }}
          >
            {message.content || " "}
          </ReactMarkdown>
        </div>

        {/* Partial tag */}
        {isPartial && (
          <div className="mt-1 text-xs text-yellow-500">
            ⚠ 消息不完整（流式中断）
          </div>
        )}

        {/* Timestamp */}
        <div
          className={`mt-1 text-right text-[10px] ${
            isUser ? "text-indigo-300/60" : "text-gray-500"
          }`}
        >
          {new Date(message.timestamp).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {message.metadata?.model && ` · ${message.metadata.model}`}
        </div>
      </div>
    </div>
  );
}
