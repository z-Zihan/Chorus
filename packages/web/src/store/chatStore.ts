import { create } from "zustand";
import { api } from "@/services/api";

export interface Message {
  id: string;
  conversationId: string;
  fromType: "user" | "agent";
  fromId: string;
  toType?: "user" | "agent";
  toId?: string;
  content: string;
  timestamp: number;
  threadId?: string;
  parentId?: string;
  status: "sending" | "thinking" | "streaming" | "done" | "partial" | "error";
  metadata?: {
    model?: string;
    tokensUsed?: number;
    durationMs?: number;
  };
}

export interface Conversation {
  id: string;
  title: string | null;
  type: "dm" | "channel" | "group";
  createdAt: number;
  updatedAt: number;
}

interface ChatState {
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: Message[];
  isStreaming: boolean;
  streamingMessageId: string | null;

  // Actions
  fetchConversations: () => Promise<void>;
  setCurrentConversation: (id: string) => void;
  fetchMessages: (conversationId: string) => Promise<void>;
  sendMessage: (content: string) => void;
  appendStreamChunk: (messageId: string, chunk: string) => void;
  setMessageStatus: (
    messageId: string,
    status: Message["status"]
  ) => void;
  addMessage: (message: Message) => void;
  cancelStream: () => void;
  createConversation: (title?: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  messages: [],
  isStreaming: false,
  streamingMessageId: null,

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
      set({ messages: data });
    } catch (e) {
      console.error("Failed to fetch messages:", e);
    }
  },

  sendMessage: (content) => {
    const convId = get().currentConversationId;
    if (!convId) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      conversationId: convId,
      fromType: "user",
      fromId: "user",
      content,
      timestamp: Date.now(),
      status: "done",
    };

    set((state) => ({
      messages: [...state.messages, userMsg],
      isStreaming: true,
    }));

    // The actual send happens via WebSocket in useWebSocket hook
    // This just adds the message to the UI optimistically
  },

  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),

  appendStreamChunk: (messageId, chunk) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId
          ? { ...m, content: m.content + chunk, status: "streaming" }
          : m
      ),
    })),

  setMessageStatus: (messageId, status) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, status } : m
      ),
      isStreaming: status === "done" || status === "error" || status === "partial" ? false : state.isStreaming,
      streamingMessageId:
        status === "done" || status === "error" || status === "partial"
          ? null
          : messageId,
    })),

  cancelStream: () => {
    const mid = get().streamingMessageId;
    if (mid) {
      get().setMessageStatus(mid, "partial");
    }
    set({ isStreaming: false, streamingMessageId: null });
  },

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
