import { useState, useRef, useCallback, useEffect } from "react";
import { Send, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/store/chatStore";
import { useAgentStore } from "@/store/agentStore";
import { AgentSelector } from "@/components/chat/AgentSelector";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { STATUS_COLORS } from "@/constants/agent";

export function InputBar() {
  const { t } = useTranslation(["common", "chat"]);
  const [input, setInput] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(-1);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const cancelStream = useChatStore((s) => s.cancelStream);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const groupConversations = useChatStore((s) => s.groupConversations);
  const archivedConversations = useChatStore((s) => s.archivedConversations);
  const agents = useAgentStore((s) => s.agents);
  const currentConversation = [
    ...conversations,
    ...groupConversations,
    ...archivedConversations,
  ].find((conversation) => conversation.id === currentConversationId);

  useEffect(() => {
    setSelectedAgentIds([]);
    setMentionQuery(null);
    setMentionStart(-1);
  }, [currentConversationId]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery]);

  useEffect(() => {
    if (selectedAgentIds.length === 0) return;
    const stillMembers = selectedAgentIds.every((agentId) =>
      currentConversation?.agentIds.includes(agentId),
    );
    const singleAgent =
      selectedAgentIds.length === 1
        ? agents.find((agent) => agent.id === selectedAgentIds[0])
        : undefined;
    if (
      !stillMembers ||
      (singleAgent && singleAgent.status !== "online" && singleAgent.status !== "busy")
    ) {
      setSelectedAgentIds([]);
    }
  }, [agents, currentConversation, selectedAgentIds]);

  const mentionAgents =
    mentionQuery !== null
      ? agents.filter(
          (agent) =>
            currentConversation?.agentIds.includes(agent.id) &&
            agent.status !== "offline" &&
            (mentionQuery === "" ||
              agent.name.toLowerCase().includes(mentionQuery) ||
              agent.id.toLowerCase().includes(mentionQuery)),
        )
      : [];

  const insertMention = (agentName: string) => {
    const el = textareaRef.current;
    if (!el || mentionStart < 0) return;
    const before = input.slice(0, mentionStart);
    const after = input.slice(el.selectionStart);
    const newValue = `${before}@${agentName} ${after}`;
    setInput(newValue);
    setMentionQuery(null);
    setMentionStart(-1);

    requestAnimationFrame(() => {
      const cursorPos = before.length + agentName.length + 2;
      el.focus();
      el.setSelectionRange(cursorPos, cursorPos);
    });
  };

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || !currentConversationId || isStreaming) return;
    const mentionedIds =
      currentConversation?.type === "group"
        ? agents
            .filter(
              (agent) =>
                currentConversation.agentIds.includes(agent.id) &&
                trimmed.includes(`@${agent.name}`),
            )
            .map((agent) => agent.id)
        : [];
    sendMessage(
      trimmed,
      mentionedIds.length > 0 ? mentionedIds : undefined,
      selectedAgentIds.length > 0 ? selectedAgentIds : undefined,
    );
    setInput("");
    setMentionQuery(null);
    setMentionStart(-1);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [
    input,
    currentConversationId,
    isStreaming,
    sendMessage,
    selectedAgentIds,
    agents,
    currentConversation,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && mentionQuery !== null) {
      setMentionQuery(null);
      setMentionStart(-1);
      return;
    }

    const mentionPickerOpen =
      mentionQuery !== null && currentConversation?.type === "group" && mentionAgents.length > 0;

    if (mentionPickerOpen && e.key === "ArrowDown") {
      e.preventDefault();
      setMentionIndex((index) => (index + 1) % mentionAgents.length);
      return;
    }

    if (mentionPickerOpen && e.key === "ArrowUp") {
      e.preventDefault();
      setMentionIndex((index) => (index - 1 + mentionAgents.length) % mentionAgents.length);
      return;
    }

    if (mentionPickerOpen && (e.key === "Enter" || e.key === "Tab")) {
      e.preventDefault();
      const agent = mentionAgents[mentionIndex];
      if (agent) insertMention(agent.name);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target;
    const value = el.value;
    setInput(value);
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";

    const cursorPos = el.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/(?:^|\s)@([^\s@]*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1].toLowerCase());
      setMentionStart(cursorPos - atMatch[1].length - 1);
    } else {
      setMentionQuery(null);
      setMentionStart(-1);
    }
  };

  return (
    <div className="border-t border-[var(--border-color)] bg-[var(--bg-surface)] px-4 py-3">
      <div className="flex items-end gap-3">
        <div className="relative flex flex-1 items-end rounded-xl border border-[var(--border-color)] bg-[var(--bg-elevated)] px-4 focus-within:border-[var(--focus-ring)] focus-within:ring-2 focus-within:ring-[var(--focus-ring)]/35">
          {mentionQuery !== null &&
            currentConversation?.type === "group" &&
            mentionAgents.length > 0 && (
              <div
                role="listbox"
                className="absolute bottom-full left-0 z-50 mb-2 max-h-48 w-56 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] shadow-xl"
              >
                {mentionAgents.map((agent, index) => (
                  <button
                    key={agent.id}
                    type="button"
                    role="option"
                    aria-selected={index === mentionIndex}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(agent.name);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--bg-hover)] ${
                      index === mentionIndex ? "bg-[var(--bg-hover)]" : ""
                    }`}
                  >
                    <AgentAvatar name={agent.name} src={agent.avatar} size="xs" />
                    <span className="flex-1 truncate">{agent.name}</span>
                    <span className={`h-2 w-2 rounded-full ${STATUS_COLORS[agent.status]}`} />
                  </button>
                ))}
              </div>
            )}
          {currentConversation?.type === "group" && (
            <>
              <AgentSelector
                agentIds={[
                  ...new Set([
                    ...currentConversation.agentIds,
                    ...agents
                      .filter((a) => a.status === "online" || a.status === "busy")
                      .map((a) => a.id),
                  ]),
                ]}
                isGroup
                value={selectedAgentIds}
                onValueChange={setSelectedAgentIds}
                disabled={isStreaming || !currentConversationId}
              />
              <div className="mx-2 h-6 w-px shrink-0 bg-[var(--border-color)]" />
            </>
          )}
          {currentConversation?.type === "group" &&
            (() => {
              const routedAgent =
                selectedAgentIds.length > 0
                  ? agents.find((a) => a.id === selectedAgentIds[0])
                  : agents.find(
                      (a) =>
                        currentConversation.agentIds.includes(a.id) &&
                        !a.stale &&
                        (a.ownerType === "remote" || a.status === "online" || a.status === "busy"),
                    );
              const displayName = routedAgent?.name ?? t("chat:noAgentAvailable");
              return (
                <span className="hidden shrink-0 items-center gap-1 text-[10px] text-[var(--text-tertiary)] sm:flex">
                  <span aria-hidden="true">→</span>
                  {displayName}
                </span>
              );
            })()}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={t("chat:inputPlaceholderShort")}
            aria-label={t("chat:messageInputLabel")}
            className="min-h-11 max-h-40 flex-1 resize-none bg-transparent py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
            disabled={isStreaming}
          />
        </div>
        {isStreaming ? (
          <Button
            variant="danger"
            onClick={cancelStream}
            aria-label={t("common:buttons.stop")}
            className="h-11 min-w-11 rounded-xl px-3 md:h-10"
          >
            <Square aria-hidden="true" className="h-4 w-4 fill-current" />
            <span className="hidden min-[360px]:inline">{t("common:buttons.stop")}</span>
          </Button>
        ) : (
          <Button
            onClick={handleSend}
            disabled={!input.trim() || !currentConversationId}
            aria-label={t("common:buttons.send")}
            className="h-11 min-w-11 rounded-xl px-3 md:h-10"
          >
            <Send aria-hidden="true" className="h-4 w-4" />
            <span className="hidden min-[360px]:inline">{t("common:buttons.send")}</span>
          </Button>
        )}
      </div>
    </div>
  );
}
