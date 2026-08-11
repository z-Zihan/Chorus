import {
  Children,
  isValidElement,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { Check, ChevronDown, ChevronUp, Copy, LoaderCircle, TriangleAlert } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { formatMessageTime } from "@/lib/date";
import type { Message } from "@/store/chatStore";
import { useUIStore } from "@/store/uiStore";

const LONG_MESSAGE_THRESHOLD = 2_000;
const COLLAPSED_MESSAGE_LENGTH = 500;

interface Props {
  message: Message;
  agentName?: string;
  agentAvatar?: string;
  isGroup?: boolean;
  showHeader?: boolean;
}

function highlightMentions(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== "string") return child;
    return child.split(/(@[\p{L}\p{N}_-]+)/gu).map((part, index) =>
      part.startsWith("@") ? (
        <span key={`${part}-${index}`} className="rounded bg-[var(--accent-color)]/20 px-0.5">
          {part}
        </span>
      ) : (
        part
      ),
    );
  });
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
  const addToast = useUIStore((state) => state.addToast);
  const [copied, setCopied] = useState(false);
  const codeElement = Children.toArray(children)[0];
  const className = isValidElement<{ className?: string }>(codeElement)
    ? (codeElement.props.className ?? "")
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
      addToast(t("errors.copyFailed"), "error");
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
          {copied ? (
            <Check aria-hidden="true" className="mr-1 inline h-3 w-3" />
          ) : (
            <Copy aria-hidden="true" className="mr-1 inline h-3 w-3" />
          )}
          {copied ? t("buttons.copied") : t("buttons.copy")}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs">{children}</pre>
    </div>
  );
}

export function MessageBubble({ message, agentName, agentAvatar, isGroup = false }: Props) {
  const { t } = useTranslation(["common", "chat"]);
  const [isExpanded, setIsExpanded] = useState(false);
  const isUser = message.fromType === "user";
  const isError = message.status === "error";
  const isPartial = message.status === "partial";
  const isStreaming = message.status === "streaming";
  const isSending = isUser && message.status === "sending";
  const isLongMessage = message.content.length > LONG_MESSAGE_THRESHOLD;
  const displayedContent =
    isLongMessage && !isExpanded
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
      data-message-id={message.id}
      className={`flex gap-3 message-enter ${isUser ? "flex-row-reverse" : "flex-row"}`}
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
          isError
            ? "border border-[var(--status-error)]/45 bg-[var(--danger-subtle)] text-[var(--text-primary)]"
            : isUser
              ? "bg-[var(--accent-color)] text-[var(--accent-foreground)]"
              : "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
        }`}
      >
        {/* Agent name label */}
        {!isUser && agentName && (
          <div className="mb-1 text-xs font-medium text-[var(--accent-hover)]">{agentName}</div>
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
              p: ({ children }) => <p>{isGroup ? highlightMentions(children) : children}</p>,
              li: ({ children }) => <li>{isGroup ? highlightMentions(children) : children}</li>,
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
              isUser && !isError
                ? "text-[var(--accent-foreground)] opacity-90 hover:opacity-100"
                : "text-[var(--accent-hover)] hover:opacity-80"
            }`}
          >
            {isExpanded ? (
              <ChevronUp aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
            ) : (
              <ChevronDown aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
            )}
            {isExpanded ? t("chat:collapseMessage") : t("chat:expandMessage")}
          </button>
        )}

        {/* Partial tag */}
        {isPartial && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md bg-[var(--warning-subtle)] px-2 py-1.5 text-xs text-[var(--status-busy)]">
            <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            {t("chat:partialMessage")}
          </div>
        )}

        {isSending && (
          <div
            className="mt-2 flex items-center justify-end gap-1.5 text-xs text-[var(--accent-foreground)] opacity-90"
            aria-live="polite"
          >
            <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            {t("chat:messageSending")}
          </div>
        )}

        {isUser && isError && (
          <div
            className="mt-2 flex items-center justify-end gap-1.5 rounded-md bg-[var(--danger-subtle)] px-2 py-1.5 text-xs font-medium text-[var(--status-error)]"
            role="alert"
          >
            <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" />
            {t("chat:messageSendFailed")}
          </div>
        )}

        {/* Timestamp */}
        <div
          className={`mt-1 text-right text-[10px] ${
            isUser && !isError
              ? "text-[var(--accent-foreground)] opacity-90"
              : "text-[var(--text-tertiary)]"
          }`}
        >
          {formatMessageTime(message.timestamp)}
          {message.metadata?.model && ` · ${message.metadata.model}`}
        </div>
      </div>
    </div>
  );
}
