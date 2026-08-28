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
import { voiceColor } from "@/lib/agentColor";
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
    <div className="relative my-2 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)]">
      <div className="flex items-center justify-end gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-3 py-1.5">
        <span className="mono rounded bg-[var(--bg-active)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
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

export function MessageBubble({
  message,
  agentName,
  agentAvatar,
  isGroup = false,
  showHeader = true,
}: Props) {
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
    const systemContent = (() => {
      if (message.metadata?.systemNotice === "a2a_round_limit") {
        return t("chat:a2aRoundLimitReached", {
          count: Number(message.metadata.a2aMaxRounds ?? 12),
        });
      }
      if (message.metadata?.systemNotice === "a2a_task_timeout") {
        return t("chat:a2aTaskTimeoutReached", {
          count: Number(message.metadata.a2aTaskTimeoutMinutes ?? 20),
        });
      }
      return message.content.replace("[system]", "").trim();
    })();
    return (
      <div className="flex justify-center py-2">
        <span
          role="status"
          className="max-w-[90%] rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1 text-center text-xs leading-5 text-[var(--text-tertiary)]"
        >
          {systemContent}
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

      {/* Voice block */}
      <div className="flex min-w-0 flex-col md:max-w-[75%]">
        {/* Name plate — one voice color per agent, shown when the speaker changes */}
        {!isUser && showHeader && agentName && (
          <div
            className="mono mb-1 text-[11px] font-medium tracking-wide"
            style={{ color: voiceColor(agentName) }}
          >
            {agentName}
          </div>
        )}

        <div
          className={`group relative max-w-[85%] px-3.5 py-2.5 md:max-w-none ${
            isUser
              ? `ml-auto rounded-2xl rounded-br-md border ${
                  isError
                    ? "border-[var(--status-error)]/45 bg-[var(--danger-subtle)]"
                    : "border-[var(--accent-color)]/40 bg-[var(--accent-subtle)]"
                } text-[var(--text-primary)]`
              : "rounded-2xl rounded-tl-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
          } ${isError && !isUser ? "border-[var(--status-error)]/45 bg-[var(--danger-subtle)]" : ""}`}
        >
          {/* Voice rail — the channel color strip inside agent cards */}
          {!isUser && agentName && (
            <span
              aria-hidden="true"
              className="absolute left-0 top-2.5 bottom-2.5 w-[2px] rounded-full opacity-80"
              style={{ backgroundColor: voiceColor(agentName) }}
            />
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
                    className="text-[var(--accent-hover)] underline decoration-[var(--accent-color)]/40 underline-offset-2 hover:decoration-[var(--accent-hover)]"
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
                  ? "text-[var(--accent-hover)] hover:opacity-80"
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
            <div className="mt-2 flex items-center gap-1.5 rounded-md bg-[var(--warning-subtle)] px-2 py-1.5 text-xs text-[var(--accent-warm)]">
              <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              {t("chat:partialMessage")}
            </div>
          )}

          {isSending && (
            <div
              className="mt-2 flex items-center justify-end gap-1.5 text-xs text-[var(--text-secondary)]"
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
        </div>

        {/* Meta row — mono, outside the card */}
        <div
          className={`mono mt-1 text-[10px] text-[var(--text-muted)] ${
            isUser ? "text-right" : "pl-1"
          } ${isUser && isSending ? "hidden" : ""}`}
        >
          {formatMessageTime(message.timestamp)}
          {message.metadata?.model && ` · ${message.metadata.model}`}
        </div>
      </div>
    </div>
  );
}
