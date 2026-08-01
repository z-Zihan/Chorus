import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "@/store/chatStore";

export function InputBar() {
  const { t } = useTranslation(["common", "chat"]);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const cancelStream = useChatStore((s) => s.cancelStream);
  const currentConversationId = useChatStore((s) => s.currentConversationId);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || !currentConversationId || isStreaming) return;
    sendMessage(trimmed);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, currentConversationId, isStreaming, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  return (
    <div className="border-t border-[var(--border-color)] bg-[var(--bg-surface)] px-4 py-3">
      <div className="flex items-end gap-3">
        <div className="flex flex-1 items-end rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-4 py-2.5 focus-within:border-[var(--accent-color)]">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={t("chat:inputPlaceholder")}
            className="max-h-40 flex-1 resize-none bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
            disabled={isStreaming}
          />
        </div>
        {isStreaming ? (
          <button
            onClick={cancelStream}
            className="flex h-10 items-center rounded-xl bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-500"
          >
            {t("common:buttons.stop")}
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim() || !currentConversationId}
            className="flex h-10 items-center rounded-xl bg-[var(--accent-color)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("common:buttons.send")}
          </button>
        )}
      </div>
    </div>
  );
}
