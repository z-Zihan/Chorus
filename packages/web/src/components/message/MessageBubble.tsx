import {
  Children,
  isValidElement,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import type { Message } from "@/store/chatStore";

const LONG_MESSAGE_THRESHOLD = 2_000;
const COLLAPSED_MESSAGE_LENGTH = 500;

interface Props {
  message: Message;
  agentName?: string;
  agentAvatar?: string;
}

function getTextContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return getTextContent(node.props.children);
  }
  return "";
}

function CodeBlock({ children }: ComponentPropsWithoutRef<"pre">) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);
  const codeElement = Children.toArray(children)[0];
  const className = isValidElement<{ className?: string }>(codeElement)
    ? codeElement.props.className ?? ""
    : "";
  const language = /language-([\w-]+)/.exec(className)?.[1] ?? "text";
  const code = getTextContent(codeElement).replace(/\n$/, "");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch (error) {
      console.error("Failed to copy code:", error);
    }
  };

  return (
    <div className="relative my-2 overflow-hidden rounded-lg bg-[var(--bg-base)]">
      <div className="flex items-center justify-end gap-2 border-b border-[var(--border-color)] px-3 py-1.5">
        <span className="rounded bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
          {language}
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="rounded px-2 py-0.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          {copied ? t("buttons.copied") : t("buttons.copy")}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs">{children}</pre>
    </div>
  );
}

export function MessageBubble({ message, agentName, agentAvatar }: Props) {
  const { t, i18n } = useTranslation(["common", "chat"]);
  const [isExpanded, setIsExpanded] = useState(false);
  const isUser = message.fromType === "user";
  const isError = message.status === "error";
  const isPartial = message.status === "partial";
  const isStreaming = message.status === "streaming";
  const isLongMessage = message.content.length > LONG_MESSAGE_THRESHOLD;
  const displayedContent = isLongMessage && !isExpanded
    ? `${message.content.slice(0, COLLAPSED_MESSAGE_LENGTH)}…`
    : message.content;

  // System message — centered gray text
  if (message.fromType === "agent" && message.content.startsWith("[system]")) {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-[var(--bg-elevated)] px-3 py-1 text-xs text-[var(--text-tertiary)]">
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
        className={`group relative max-w-[85%] rounded-2xl px-4 py-2.5 md:max-w-[75%] ${
          isUser
            ? "bg-[var(--accent-color)] text-white"
            : isError
            ? "border border-red-700/50 bg-red-900/40 text-red-200"
            : "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
        }`}
      >
        {/* Agent name label */}
        {!isUser && agentName && (
          <div className="mb-1 text-xs font-medium text-[var(--accent-hover)]">
            {agentName}
          </div>
        )}

        {/* Content */}
        <div
          className={`break-words text-sm leading-relaxed [&_code]:rounded [&_code]:bg-[var(--bg-active)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_pre_code]:bg-transparent [&_pre_code]:p-0 ${
            isStreaming ? "typing-cursor" : ""
          }`}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre: CodeBlock,
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent-hover)] underline hover:opacity-80"
                >
                  {children}
                </a>
              ),
            }}
          >
            {displayedContent || " "}
          </ReactMarkdown>
        </div>

        {isLongMessage && (
          <button
            type="button"
            onClick={() => setIsExpanded((expanded) => !expanded)}
            className={`mt-2 text-xs font-medium transition-colors ${
              isUser
                ? "text-indigo-100 hover:text-white"
                : "text-[var(--accent-hover)] hover:opacity-80"
            }`}
          >
            {isExpanded ? t("chat:collapseMessage") : t("chat:expandMessage")}
          </button>
        )}

        {/* Partial tag */}
        {isPartial && (
          <div className="mt-1 text-xs text-yellow-500">
            ⚠ {t("chat:partialMessage")}
          </div>
        )}

        {/* Timestamp */}
        <div
          className={`mt-1 text-right text-[10px] ${
            isUser ? "text-indigo-200/70" : "text-[var(--text-tertiary)]"
          }`}
        >
          {new Date(message.timestamp).toLocaleTimeString(i18n.resolvedLanguage, {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {message.metadata?.model && ` · ${message.metadata.model}`}
        </div>
      </div>
    </div>
  );
}
