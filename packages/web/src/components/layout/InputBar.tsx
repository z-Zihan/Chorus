import { useState, useRef, useCallback } from "react";
import { Send, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
          <Button variant="danger" onClick={cancelStream} className="rounded-xl">
            <Square aria-hidden="true" className="h-4 w-4 fill-current" />
            {t("common:buttons.stop")}
          </Button>
        ) : (
          <Button
            onClick={handleSend}
            disabled={!input.trim() || !currentConversationId}
            className="rounded-xl"
          >
            <Send aria-hidden="true" className="h-4 w-4" />
            {t("common:buttons.send")}
          </Button>
        )}
      </div>
    </div>
  );
}
