import { create } from "zustand";
import type { ClientEvent, Conversation, Message } from "@agentlink/shared";
import { api } from "@/services/api";
import { useAgentStore } from "@/store/agentStore";
import { useUIStore } from "@/store/uiStore";
import i18n from "@/i18n";

export type { Conversation, Message } from "@agentlink/shared";

type WebSocketSend = (event: ClientEvent) => boolean;
const STREAM_TIMEOUT_MS = 60_000;

interface ChatState {
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: Message[];
  isLoadingMessages: boolean;
  isStreaming: boolean;
  streamingMessageId: string | null;
  webSocketSend: WebSocketSend | null;

  // Actions
  fetchConversations: () => Promise<void>;
  setCurrentConversation: (id: string) => void;
  fetchMessages: (conversationId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  appendStreamChunk: (messageId: string, chunk: string) => void;
  noteStreamActivity: (messageId: string) => void;
  setMessageStatus: (
    messageId: string,
    status: Message["status"]
  ) => void;
  addMessage: (message: Message) => void;
  cancelStream: () => void;
  setWebSocketSend: (send: WebSocketSend | null) => void;
  createConversation: (title?: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<boolean>;
}

export const useChatStore = create<ChatState>((set, get) => {
  let streamTimer: ReturnType<typeof setTimeout> | null = null;
  let timeoutMessageId: string | null = null;
  let fallbackController: AbortController | null = null;
  let messagesRequestId = 0;

  const clearStreamTimer = () => {
    if (streamTimer) clearTimeout(streamTimer);
    streamTimer = null;
    timeoutMessageId = null;
  };

  const armStreamTimer = (messageId: string) => {
    clearStreamTimer();
    timeoutMessageId = messageId;
    streamTimer = setTimeout(() => {
      const state = get();
      if (!state.isStreaming) {
        clearStreamTimer();
        return;
      }

      const targetId = state.streamingMessageId ?? timeoutMessageId;
      if (state.streamingMessageId) {
        state.webSocketSend?.({
          type: "cancel",
          messageId: state.streamingMessageId,
        });
      }
      fallbackController?.abort();
      fallbackController = null;

      set((current) => ({
        messages: targetId
          ? current.messages.map((message) =>
              message.id === targetId
                ? { ...message, status: "error" as const }
                : message
            )
          : current.messages,
        isStreaming: false,
        streamingMessageId: null,
      }));
      useUIStore.getState().addToast(i18n.t("errors:agentTimeout"), "error");
      clearStreamTimer();
    }, STREAM_TIMEOUT_MS);
  };

  return {
    conversations: [],
    currentConversationId: null,
    messages: [],
    isLoadingMessages: false,
    isStreaming: false,
    streamingMessageId: null,
    webSocketSend: null,

    fetchConversations: async () => {
      try {
        const data = await api.getConversations();
        set({ conversations: data });
        // Auto-select first conversation if none selected
        if (!get().currentConversationId && data.length > 0) {
          get().setCurrentConversation(data[0].id);
        }
      } catch (e) {
        console.error("Failed to fetch conversations:", e);
      }
    },

  setCurrentConversation: (id) => {
    if (get().currentConversationId === id) return;
    set({ currentConversationId: id, messages: [], isLoadingMessages: true });
    get().fetchMessages(id);
  },

  fetchMessages: async (conversationId) => {
    const requestId = ++messagesRequestId;
    if (get().currentConversationId === conversationId) {
      set({ isLoadingMessages: true });
    }
    try {
      const data = await api.getMessages(conversationId);
      if (
        requestId === messagesRequestId &&
        get().currentConversationId === conversationId
      ) {
        set({ messages: data });
      }
    } catch (e) {
      console.error("Failed to fetch messages:", e);
    } finally {
      if (
        requestId === messagesRequestId &&
        get().currentConversationId === conversationId
      ) {
        set({ isLoadingMessages: false });
      }
    }
  },

  sendMessage: async (content) => {
    const convId = get().currentConversationId;
    if (!convId) return;

    const trimmedContent = content.trim();
    if (!trimmedContent) return;

    const conversation = get().conversations.find((item) => item.id === convId);
    const activeAgentId = conversation?.agentIds[0];
    const activeAgent = useAgentStore
      .getState()
      .agents.find((agent) => agent.id === activeAgentId);
    if (!activeAgent || activeAgent.status !== "online") {
      useUIStore.getState().addToast(i18n.t("errors:agentUnavailable"), "error");
      return;
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      conversationId: convId,
      fromType: "user",
      fromId: "user",
      content: trimmedContent,
      timestamp: Date.now(),
      status: "sending",
    };

    set((state) => ({
      messages: [...state.messages, userMsg],
      isStreaming: true,
    }));
    armStreamTimer(userMsg.id);

    const sent = get().webSocketSend?.({
      type: "message",
      conversationId: convId,
      content: trimmedContent,
    });
    if (sent) return;

    // Keep sending functional while the socket is still connecting/reconnecting.
    const controller = new AbortController();
    fallbackController = controller;
    try {
      await api.sendMessage(convId, trimmedContent, controller.signal);
      clearStreamTimer();
      await get().fetchMessages(convId);
      set({ isStreaming: false, streamingMessageId: null });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.error("Failed to send message:", error);
        clearStreamTimer();
        get().setMessageStatus(userMsg.id, "error");
        set({ isStreaming: false, streamingMessageId: null });
      }
    } finally {
      if (fallbackController === controller) fallbackController = null;
    }
  },

  addMessage: (message) =>
    set((state) => {
      const existingIndex = state.messages.findIndex((item) => item.id === message.id);
      const optimisticIndex = message.fromType === "user"
        ? state.messages.findIndex((item) =>
            item.fromType === "user" &&
            item.status === "sending" &&
            item.conversationId === message.conversationId &&
            item.content === message.content
          )
        : -1;
      const replaceIndex = existingIndex >= 0 ? existingIndex : optimisticIndex;
      const messages = [...state.messages];
      if (replaceIndex >= 0) messages[replaceIndex] = message;
      else messages.push(message);

      if (message.fromType !== "agent" || message.threadId) return { messages };
      if (message.status === "thinking" || message.status === "streaming") {
        return { messages, isStreaming: true, streamingMessageId: message.id };
      }
      if (
        state.streamingMessageId === message.id &&
        (message.status === "done" || message.status === "partial" || message.status === "error")
      ) {
        clearStreamTimer();
        return { messages, isStreaming: false, streamingMessageId: null };
      }
      return { messages };
    }),

  appendStreamChunk: (messageId, chunk) =>
    set((state) => {
      const target = state.messages.find((message) => message.id === messageId);
      return {
        messages: state.messages.map((m) =>
        m.id === messageId
          ? { ...m, content: m.content + chunk, status: "streaming" }
          : m
        ),
        ...(target && !target.threadId
          ? { isStreaming: true, streamingMessageId: messageId }
          : {}),
      };
    }),

  noteStreamActivity: (messageId) => {
    const target = get().messages.find((message) => message.id === messageId);
    if (target?.fromType === "agent" && !target.threadId) {
      armStreamTimer(messageId);
    }
  },

  setMessageStatus: (messageId, status) =>
    set((state) => {
      const target = state.messages.find((message) => message.id === messageId);
      const isTerminal = status === "done" || status === "error" || status === "partial";
      const isPrimaryStream = Boolean(target?.fromType === "agent" && !target.threadId);
      if (isPrimaryStream && isTerminal) clearStreamTimer();
      return {
        messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, status } : m
        ),
        isStreaming: isPrimaryStream ? !isTerminal : state.isStreaming,
        streamingMessageId: isPrimaryStream
          ? (isTerminal ? null : messageId)
          : state.streamingMessageId,
      };
    }),

  cancelStream: () => {
    clearStreamTimer();
    fallbackController?.abort();
    fallbackController = null;
    const mid = get().streamingMessageId;
    if (mid) {
      get().webSocketSend?.({ type: "cancel", messageId: mid });
      get().setMessageStatus(mid, "partial");
    }
    set({ isStreaming: false, streamingMessageId: null });
  },

  setWebSocketSend: (webSocketSend) => set({ webSocketSend }),

    createConversation: async (title) => {
      try {
        const conv = await api.createConversation(title);
        set((state) => ({
          conversations: [conv, ...state.conversations],
          currentConversationId: conv.id,
          messages: [],
          isLoadingMessages: false,
        }));
      } catch (e) {
        console.error("Failed to create conversation:", e);
      }
    },

    deleteConversation: async (id) => {
      try {
        await api.deleteConversation(id);
        const state = get();
        const deletedIndex = state.conversations.findIndex(
          (conversation) => conversation.id === id
        );
        const conversations = state.conversations.filter(
          (conversation) => conversation.id !== id
        );

        if (state.currentConversationId !== id) {
          set({ conversations });
          return true;
        }

        clearStreamTimer();
        fallbackController?.abort();
        fallbackController = null;
        messagesRequestId += 1;
        const nextConversation =
          conversations[deletedIndex] ?? conversations[deletedIndex - 1] ?? null;

        set({
          conversations,
          currentConversationId: nextConversation?.id ?? null,
          messages: [],
          isLoadingMessages: Boolean(nextConversation),
          isStreaming: false,
          streamingMessageId: null,
        });
        if (nextConversation) {
          await get().fetchMessages(nextConversation.id);
        }
        return true;
      } catch (e) {
        console.error("Failed to delete conversation:", e);
        return false;
      }
    },
  };
});
