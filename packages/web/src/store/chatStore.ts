import { create } from "zustand";
import type { ClientEvent, Conversation, Message } from "@agentlink/shared";
import { api } from "@/services/api";
import { useAgentStore } from "@/store/agentStore";
import { StreamManager } from "@/store/streamManager";
import { useUIStore } from "@/store/uiStore";
import i18n from "@/i18n";
import { track } from "@/utils/analytics";
import { logger } from "@/utils/logger";

export type { Conversation, Message } from "@agentlink/shared";

type WebSocketSend = (event: ClientEvent) => boolean;

interface ChatState {
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: Message[];
  isLoadingMessages: boolean;
  isStreaming: boolean;
  streamingMessageId: string | null;
  webSocketSend: WebSocketSend | null;

  fetchConversations: () => Promise<void>;
  setCurrentConversation: (id: string) => void;
  fetchMessages: (conversationId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  appendStreamChunk: (messageId: string, chunk: string) => void;
  noteStreamActivity: (messageId: string) => void;
  setMessageStatus: (messageId: string, status: Message["status"]) => void;
  addMessage: (message: Message) => void;
  cancelStream: () => void;
  setWebSocketSend: (send: WebSocketSend | null) => void;
  createConversation: (title?: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<boolean>;
}

export const useChatStore = create<ChatState>((set, get) => {
  let messagesRequestId = 0;
  const streamManager = new StreamManager(get, set);

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
        logger.error("Failed to fetch conversations", e);
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
      logger.error("Failed to fetch messages", e);
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
    track("message_sent", { conversationId: convId, transport: get().webSocketSend ? "websocket" : "http" });
    streamManager.armStreamTimer(userMsg.id);

    const sent = get().webSocketSend?.({
      type: "message",
      conversationId: convId,
      content: trimmedContent,
    });
    if (sent) return;

    // Keep sending functional while the socket is still connecting/reconnecting.
    const controller = new AbortController();
    streamManager.setFallbackController(controller);
    try {
      await api.sendMessage(convId, trimmedContent, controller.signal);
      streamManager.clearStreamTimer();
      await get().fetchMessages(convId);
      set({ isStreaming: false, streamingMessageId: null });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        logger.error("Failed to send message", error);
        track("error_occurred", { message: "Failed to send message", source: "chat_store", lineno: 0 });
        streamManager.clearStreamTimer();
        get().setMessageStatus(userMsg.id, "error");
        set({ isStreaming: false, streamingMessageId: null });
      }
    } finally {
      streamManager.clearFallbackController(controller);
    }
  },

  addMessage: (message) => streamManager.addMessage(message),
  appendStreamChunk: (messageId, chunk) => streamManager.appendStreamChunk(messageId, chunk),
  noteStreamActivity: (messageId) => streamManager.noteStreamActivity(messageId),
  setMessageStatus: (messageId, status) => streamManager.setMessageStatus(messageId, status),
  cancelStream: () => streamManager.cancelStream(),

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
        track("conversation_created", { conversationId: conv.id });
      } catch (e) {
        logger.error("Failed to create conversation", e);
      }
    },

    deleteConversation: async (id) => {
      try {
        await api.deleteConversation(id);
        track("conversation_deleted", { conversationId: id });
        const state = get();
        const deletedIndex = state.conversations.findIndex((conversation) => conversation.id === id);
        const conversations = state.conversations.filter((conversation) => conversation.id !== id);

        if (state.currentConversationId !== id) {
          set({ conversations });
          return true;
        }

        streamManager.clearStreamTimer();
        streamManager.abortFallback();
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
        logger.error("Failed to delete conversation", e);
        return false;
      }
    },
  };
});
