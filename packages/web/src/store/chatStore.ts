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
  archivedConversations: Conversation[];
  currentConversationId: string | null;
  targetMessageId: string | null;
  messages: Message[];
  isLoadingMessages: boolean;
  isStreaming: boolean;
  streamingMessageId: string | null;
  webSocketSend: WebSocketSend | null;

  fetchConversations: (includeArchived?: boolean) => Promise<void>;
  setCurrentConversation: (id: string) => void;
  navigateToMessage: (conversationId: string, messageId: string) => void;
  clearTargetMessage: () => void;
  fetchMessages: (conversationId: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  appendStreamChunk: (messageId: string, chunk: string) => void;
  noteStreamActivity: (messageId: string) => void;
  setMessageStatus: (messageId: string, status: Message["status"]) => void;
  addMessage: (message: Message) => void;
  cancelStream: () => void;
  setWebSocketSend: (send: WebSocketSend | null) => void;
  createConversation: (title?: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<boolean>;
  togglePin: (id: string) => Promise<void>;
  toggleArchive: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<boolean>;
  deleteConversations: (ids: string[]) => Promise<number>;
}

function sortConversations(items: Conversation[]): Conversation[] {
  return [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

export const useChatStore = create<ChatState>((set, get) => {
  let messagesRequestId = 0;
  const streamManager = new StreamManager(get, set);

  return {
    conversations: [],
    archivedConversations: [],
    currentConversationId: null,
    targetMessageId: null,
    messages: [],
    isLoadingMessages: false,
    isStreaming: false,
    streamingMessageId: null,
    webSocketSend: null,

    fetchConversations: async (includeArchived = true) => {
      try {
        const [data, archived] = await Promise.all([
          api.getConversations(),
          includeArchived ? api.getConversations(true) : Promise.resolve([]),
        ]);
        set({
          conversations: sortConversations(data),
          archivedConversations: sortConversations(archived),
        });
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

  navigateToMessage: (conversationId, messageId) => {
    set({ targetMessageId: messageId });
    if (get().currentConversationId === conversationId) return;
    get().setCurrentConversation(conversationId);
  },

  clearTargetMessage: () => set({ targetMessageId: null }),

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

    const conversation = [...get().conversations, ...get().archivedConversations]
      .find((item) => item.id === convId);
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
          conversations: sortConversations([conv, ...state.conversations]),
          currentConversationId: conv.id,
          messages: [],
          isLoadingMessages: false,
        }));
        track("conversation_created", { conversationId: conv.id });
      } catch (e) {
        logger.error("Failed to create conversation", e);
      }
    },

    renameConversation: async (id, title) => {
      const trimmed = title.trim();
      if (!trimmed) return false;
      try {
        const updated = await api.updateConversation(id, { title: trimmed });
        set((state) => ({
          conversations: state.conversations.map((item) => item.id === id ? updated : item),
          archivedConversations: state.archivedConversations.map((item) => item.id === id ? updated : item),
        }));
        return true;
      } catch (error) {
        logger.error("Failed to rename conversation", error);
        return false;
      }
    },

    togglePin: async (id) => {
      const state = get();
      const conversation = [...state.conversations, ...state.archivedConversations]
        .find((item) => item.id === id);
      if (!conversation) return;
      try {
        const updated = await api.updateConversation(id, { pinned: !conversation.pinned });
        set((current) => ({
          conversations: sortConversations(current.conversations.map((item) => item.id === id ? updated : item)),
          archivedConversations: sortConversations(current.archivedConversations.map((item) => item.id === id ? updated : item)),
        }));
      } catch (error) {
        logger.error("Failed to pin conversation", error);
      }
    },

    toggleArchive: async (id) => {
      const state = get();
      const conversation = [...state.conversations, ...state.archivedConversations]
        .find((item) => item.id === id);
      if (!conversation) return;
      try {
        const updated = await api.updateConversation(id, { archived: !conversation.archived });
        const current = get();
        const conversations = sortConversations([
          ...current.conversations.filter((item) => item.id !== id),
          ...(!updated.archived ? [updated] : []),
        ]);
        const archivedConversations = sortConversations([
          ...current.archivedConversations.filter((item) => item.id !== id),
          ...(updated.archived ? [updated] : []),
        ]);
        if (updated.archived && current.currentConversationId === id) {
          const nextConversation = conversations[0] ?? null;
          messagesRequestId += 1;
          set({
            conversations,
            archivedConversations,
            currentConversationId: nextConversation?.id ?? null,
            messages: [],
            isLoadingMessages: Boolean(nextConversation),
            targetMessageId: null,
          });
          if (nextConversation) await get().fetchMessages(nextConversation.id);
        } else {
          set({ conversations, archivedConversations });
        }
      } catch (error) {
        logger.error("Failed to archive conversation", error);
      }
    },

    deleteConversation: async (id) => {
      try {
        await api.deleteConversation(id);
        track("conversation_deleted", { conversationId: id });
        const state = get();
        const allConversations = [...state.conversations, ...state.archivedConversations];
        const deletedIndex = allConversations.findIndex((conversation) => conversation.id === id);
        const conversations = state.conversations.filter((conversation) => conversation.id !== id);
        const archivedConversations = state.archivedConversations.filter((conversation) => conversation.id !== id);

        if (state.currentConversationId !== id) {
          set({ conversations, archivedConversations });
          return true;
        }

        streamManager.clearStreamTimer();
        streamManager.abortFallback();
        messagesRequestId += 1;
        const nextConversation =
          conversations[deletedIndex] ?? conversations[deletedIndex - 1] ?? conversations[0] ?? null;

        set({
          conversations,
          archivedConversations,
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

    deleteConversations: async (ids) => {
      if (ids.length === 0) return 0;
      try {
        const { count } = await api.deleteConversations(ids);
        const deletedIds = new Set(ids);
        const state = get();
        const conversations = state.conversations.filter((item) => !deletedIds.has(item.id));
        const archivedConversations = state.archivedConversations.filter((item) => !deletedIds.has(item.id));
        const currentWasDeleted = state.currentConversationId
          ? deletedIds.has(state.currentConversationId)
          : false;
        if (!currentWasDeleted) {
          set({ conversations, archivedConversations });
          return count;
        }
        streamManager.clearStreamTimer();
        streamManager.abortFallback();
        messagesRequestId += 1;
        const nextConversation = conversations[0] ?? null;
        set({
          conversations,
          archivedConversations,
          currentConversationId: nextConversation?.id ?? null,
          messages: [],
          isLoadingMessages: Boolean(nextConversation),
          isStreaming: false,
          streamingMessageId: null,
          targetMessageId: null,
        });
        if (nextConversation) await get().fetchMessages(nextConversation.id);
        return count;
      } catch (error) {
        logger.error("Failed to delete conversations", error);
        return 0;
      }
    },
  };
});
