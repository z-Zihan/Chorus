import { create } from "zustand";
import type { ClientEvent, Conversation, Message } from "@agentlink/shared";
import { api } from "@/services/api";

export type { Conversation, Message } from "@agentlink/shared";

type WebSocketSend = (event: ClientEvent) => boolean;

interface ChatState {
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: Message[];
  isStreaming: boolean;
  streamingMessageId: string | null;
  webSocketSend: WebSocketSend | null;

  // Actions
  fetchConversations: () => Promise<void>;
  setCurrentConversation: (id: string) => void;
  fetchMessages: (conversationId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  appendStreamChunk: (messageId: string, chunk: string) => void;
  setMessageStatus: (
    messageId: string,
    status: Message["status"]
  ) => void;
  addMessage: (message: Message) => void;
  cancelStream: () => void;
  setWebSocketSend: (send: WebSocketSend | null) => void;
  createConversation: (title?: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  messages: [],
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
    set({ currentConversationId: id, messages: [] });
    get().fetchMessages(id);
  },

  fetchMessages: async (conversationId) => {
    try {
      const data = await api.getMessages(conversationId);
      if (get().currentConversationId === conversationId) {
        set({ messages: data });
      }
    } catch (e) {
      console.error("Failed to fetch messages:", e);
    }
  },

  sendMessage: async (content) => {
    const convId = get().currentConversationId;
    if (!convId) return;

    const trimmedContent = content.trim();
    if (!trimmedContent) return;

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

    const sent = get().webSocketSend?.({
      type: "message",
      conversationId: convId,
      content: trimmedContent,
    });
    if (sent) return;

    // Keep sending functional while the socket is still connecting/reconnecting.
    try {
      await api.sendMessage(convId, trimmedContent);
      await get().fetchMessages(convId);
    } catch (error) {
      console.error("Failed to send message:", error);
      get().setMessageStatus(userMsg.id, "error");
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

  setMessageStatus: (messageId, status) =>
    set((state) => {
      const target = state.messages.find((message) => message.id === messageId);
      const isTerminal = status === "done" || status === "error" || status === "partial";
      const isPrimaryStream = Boolean(target && !target.threadId);
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
      }));
    } catch (e) {
      console.error("Failed to create conversation:", e);
    }
  },
}));
