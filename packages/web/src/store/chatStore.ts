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

export interface A2AThreadState {
  threadId: string;
  conversationId: string;
  parentMessageId?: string;
  from: string;
  to: string;
  message: string;
  result: string;
  error?: string;
  status: "running" | "completed" | "error";
  startedAt: number;
  completedAt?: number;
}

export interface A2AConfirmation {
  threadId: string;
  from: string;
  to: string;
  message: string;
  expiresAt: number;
}

interface ChatState {
  conversations: Conversation[];
  groupConversations: Conversation[];
  archivedConversations: Conversation[];
  currentConversationId: string | null;
  targetMessageId: string | null;
  messages: Message[];
  isLoadingMessages: boolean;
  isStreaming: boolean;
  streamingMessageId: string | null;
  a2aThreads: Record<string, A2AThreadState>;
  a2aConfirmations: A2AConfirmation[];
  webSocketSend: WebSocketSend | null;

  fetchConversations: (includeArchived?: boolean) => Promise<void>;
  setCurrentConversation: (id: string) => void;
  navigateToConversation: (id: string) => void;
  navigateToMessage: (conversationId: string, messageId: string) => void;
  clearTargetMessage: () => void;
  fetchMessages: (conversationId: string) => Promise<void>;
  sendMessage: (content: string, mentionedAgentIds?: string[]) => Promise<void>;
  appendStreamChunk: (messageId: string, chunk: string) => void;
  noteStreamActivity: (messageId: string) => void;
  setMessageStatus: (messageId: string, status: Message["status"]) => void;
  addMessage: (message: Message) => void;
  cancelStream: () => void;
  startA2AThread: (thread: Omit<A2AThreadState, "result" | "status" | "startedAt">) => void;
  completeA2AThread: (threadId: string, result: string) => void;
  failA2AThread: (threadId: string, error: string) => void;
  cancelA2AThread: (threadId: string) => void;
  requestA2AConfirmation: (confirmation: A2AConfirmation) => void;
  dismissA2AConfirmation: (threadId: string) => void;
  setWebSocketSend: (send: WebSocketSend | null) => void;
  createConversation: (title?: string, agentId?: string) => Promise<void>;
  createGroupConversation: (title: string, agentIds: string[]) => Promise<void>;
  syncConversation: (conversation: Conversation) => void;
  renameConversation: (id: string, title: string) => Promise<boolean>;
  togglePin: (id: string) => Promise<void>;
  toggleArchive: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<boolean>;
  deleteConversations: (ids: string[]) => Promise<number>;
}

function sortConversations(items: Conversation[]): Conversation[] {
  return [...items].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
  );
}

export const useChatStore = create<ChatState>((set, get) => {
  let messagesRequestId = 0;
  const streamManager = new StreamManager(get, set);

  return {
    conversations: [],
    groupConversations: [],
    archivedConversations: [],
    currentConversationId: null,
    targetMessageId: null,
    messages: [],
    isLoadingMessages: false,
    isStreaming: false,
    streamingMessageId: null,
    a2aThreads: {},
    a2aConfirmations: [],
    webSocketSend: null,

    fetchConversations: async (includeArchived = true) => {
      try {
        const [data, groups, archived] = await Promise.all([
          api.getConversations(false, "dm"),
          api.getConversations(false, "group"),
          includeArchived ? api.getConversations(true) : Promise.resolve([]),
        ]);
        set({
          conversations: sortConversations(data),
          groupConversations: sortConversations(groups),
          archivedConversations: sortConversations(archived),
        });
        // Auto-select first conversation if none selected
        const firstConversation = data[0] ?? groups[0];
        if (!get().currentConversationId && firstConversation) {
          get().setCurrentConversation(firstConversation.id);
        }
      } catch (e) {
        logger.error("Failed to fetch conversations", e);
      }
    },

    setCurrentConversation: (id) => {
      if (get().currentConversationId === id) return;
      set({
        currentConversationId: id,
        messages: [],
        a2aThreads: {},
        a2aConfirmations: [],
        isLoadingMessages: true,
      });
      get().fetchMessages(id);
    },

    navigateToConversation: (id) => {
      set({ targetMessageId: null });
      if (get().currentConversationId === id) return;
      get().setCurrentConversation(id);
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
        if (requestId === messagesRequestId && get().currentConversationId === conversationId) {
          set({ messages: data });
        }
      } catch (e) {
        logger.error("Failed to fetch messages", e);
      } finally {
        if (requestId === messagesRequestId && get().currentConversationId === conversationId) {
          set({ isLoadingMessages: false });
        }
      }
    },

    sendMessage: async (content, mentionedAgentIds = []) => {
      const convId = get().currentConversationId;
      if (!convId) return;

      const trimmedContent = content.trim();
      if (!trimmedContent) return;

      const conversation = [
        ...get().conversations,
        ...get().groupConversations,
        ...get().archivedConversations,
      ].find((item) => item.id === convId);
      const isGroup = conversation?.type === "group";
      const selectedAgentIds = [...new Set(mentionedAgentIds)];
      if (selectedAgentIds.some((agentId) => !conversation?.agentIds.includes(agentId))) {
        useUIStore.getState().addToast(i18n.t("errors:agentUnavailable"), "error");
        return;
      }
      const availableAgents = useAgentStore.getState().agents;
      const isOnline = (agentId: string) =>
        availableAgents.some(
          (agent) => agent.id === agentId && (agent.status === "online" || agent.status === "busy"),
        );
      const firstOnlineAgentId = conversation?.agentIds.find(isOnline);
      const activeAgentId = isGroup
        ? selectedAgentIds.length === 1
          ? selectedAgentIds[0]
          : firstOnlineAgentId
        : (selectedAgentIds[0] ?? conversation?.agentIds[0]);
      const routableAgentIds =
        isGroup && selectedAgentIds.length > 0
          ? selectedAgentIds.filter(isOnline)
          : activeAgentId
            ? [activeAgentId].filter(isOnline)
            : [];
      if (routableAgentIds.length === 0) {
        useUIStore.getState().addToast(i18n.t("errors:agentUnavailable"), "error");
        return;
      }

      const userMsg: Message = {
        id: crypto.randomUUID(),
        conversationId: convId,
        fromType: "user",
        fromId: "user",
        toType: "agent",
        toId: activeAgentId,
        content: trimmedContent,
        timestamp: Date.now(),
        status: "sending",
      };

      set((state) => ({
        messages: [...state.messages, userMsg],
        isStreaming: true,
      }));
      track("message_sent", {
        conversationId: convId,
        transport: get().webSocketSend ? "websocket" : "http",
      });
      streamManager.armStreamTimer(userMsg.id);

      const mentionedAgents = isGroup && selectedAgentIds.length > 0 ? selectedAgentIds : undefined;
      const sent = get().webSocketSend?.({
        type: "message",
        conversationId: convId,
        content: trimmedContent,
        agentId: isGroup ? undefined : activeAgentId,
        mentionedAgents,
      });
      if (sent) return;

      // Keep sending functional while the socket is still connecting/reconnecting.
      const controller = new AbortController();
      streamManager.setFallbackController(controller);
      try {
        await api.sendMessage(
          convId,
          trimmedContent,
          controller.signal,
          isGroup ? undefined : activeAgentId,
          mentionedAgents,
        );
        streamManager.clearStreamTimer();
        await get().fetchMessages(convId);
        set({ isStreaming: false, streamingMessageId: null });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          logger.error("Failed to send message", error);
          track("error_occurred", {
            message: "Failed to send message",
            source: "chat_store",
            lineno: 0,
          });
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

    startA2AThread: (thread) =>
      set((state) => ({
        a2aThreads: {
          ...state.a2aThreads,
          [thread.threadId]: {
            ...thread,
            result: "",
            status: "running",
            startedAt: Date.now(),
          },
        },
      })),

    completeA2AThread: (threadId, result) =>
      set((state) => {
        const thread = state.a2aThreads[threadId];
        if (!thread) return {};
        return {
          a2aThreads: {
            ...state.a2aThreads,
            [threadId]: {
              ...thread,
              result,
              error: undefined,
              status: "completed",
              completedAt: Date.now(),
            },
          },
        };
      }),

    failA2AThread: (threadId, error) =>
      set((state) => {
        const thread = state.a2aThreads[threadId];
        if (!thread) return {};
        return {
          a2aThreads: {
            ...state.a2aThreads,
            [threadId]: { ...thread, error, status: "error", completedAt: Date.now() },
          },
        };
      }),

    cancelA2AThread: (threadId) => {
      get().webSocketSend?.({ type: "cancel", messageId: threadId });
      get().failA2AThread(threadId, i18n.t("chat:a2aCancelled"));
    },

    requestA2AConfirmation: (confirmation) =>
      set((state) => ({
        a2aConfirmations: state.a2aConfirmations.some(
          (item) => item.threadId === confirmation.threadId,
        )
          ? state.a2aConfirmations
          : [...state.a2aConfirmations, confirmation],
      })),

    dismissA2AConfirmation: (threadId) =>
      set((state) => ({
        a2aConfirmations: state.a2aConfirmations.filter((item) => item.threadId !== threadId),
      })),

    setWebSocketSend: (webSocketSend) => set({ webSocketSend }),

    createConversation: async (title, agentId) => {
      const targetAgentId = agentId ?? useAgentStore.getState().selectedAgentId ?? undefined;
      const current = get();
      // Block only if: current is empty AND same agent (avoid duplicate empty convos)
      if (current.currentConversationId && current.messages.length === 0 && !current.isStreaming) {
        const conv = [...current.conversations, ...current.groupConversations].find(
          (c) => c.id === current.currentConversationId,
        );
        if (conv && (!targetAgentId || conv.agentIds.includes(targetAgentId))) {
          // Switch to the existing empty conversation instead of creating a new one
          if (conv.agentIds[0] === targetAgentId) return;
        }
      }

      try {
        const conv = await api.createConversation(title, targetAgentId);
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

    createGroupConversation: async (title, agentIds) => {
      try {
        const conv = await api.createConversation(title, agentIds, "group");
        set((state) => ({
          groupConversations: sortConversations([conv, ...state.groupConversations]),
          currentConversationId: conv.id,
          messages: [],
          isLoadingMessages: false,
        }));
        track("conversation_created", { conversationId: conv.id, type: "group" });
      } catch (error) {
        logger.error("Failed to create group conversation", error);
      }
    },

    syncConversation: (conversation) =>
      set((state) => ({
        conversations: state.conversations.map((item) =>
          item.id === conversation.id ? conversation : item,
        ),
        groupConversations: state.groupConversations.map((item) =>
          item.id === conversation.id ? conversation : item,
        ),
        archivedConversations: state.archivedConversations.map((item) =>
          item.id === conversation.id ? conversation : item,
        ),
      })),

    renameConversation: async (id, title) => {
      const trimmed = title.trim();
      if (!trimmed) return false;
      try {
        const updated = await api.updateConversation(id, { title: trimmed });
        set((state) => ({
          conversations: state.conversations.map((item) => (item.id === id ? updated : item)),
          groupConversations: state.groupConversations.map((item) =>
            item.id === id ? updated : item,
          ),
          archivedConversations: state.archivedConversations.map((item) =>
            item.id === id ? updated : item,
          ),
        }));
        return true;
      } catch (error) {
        logger.error("Failed to rename conversation", error);
        return false;
      }
    },

    togglePin: async (id) => {
      const state = get();
      const conversation = [
        ...state.conversations,
        ...state.groupConversations,
        ...state.archivedConversations,
      ].find((item) => item.id === id);
      if (!conversation) return;
      try {
        const updated = await api.updateConversation(id, { pinned: !conversation.pinned });
        set((current) => ({
          conversations: sortConversations(
            current.conversations.map((item) => (item.id === id ? updated : item)),
          ),
          groupConversations: sortConversations(
            current.groupConversations.map((item) => (item.id === id ? updated : item)),
          ),
          archivedConversations: sortConversations(
            current.archivedConversations.map((item) => (item.id === id ? updated : item)),
          ),
        }));
      } catch (error) {
        logger.error("Failed to pin conversation", error);
      }
    },

    toggleArchive: async (id) => {
      const state = get();
      const conversation = [
        ...state.conversations,
        ...state.groupConversations,
        ...state.archivedConversations,
      ].find((item) => item.id === id);
      if (!conversation) return;
      try {
        const updated = await api.updateConversation(id, { archived: !conversation.archived });
        const current = get();
        const conversations = sortConversations([
          ...current.conversations.filter((item) => item.id !== id),
          ...(!updated.archived && updated.type === "dm" ? [updated] : []),
        ]);
        const groupConversations = sortConversations([
          ...current.groupConversations.filter((item) => item.id !== id),
          ...(!updated.archived && updated.type === "group" ? [updated] : []),
        ]);
        const archivedConversations = sortConversations([
          ...current.archivedConversations.filter((item) => item.id !== id),
          ...(updated.archived ? [updated] : []),
        ]);
        if (updated.archived && current.currentConversationId === id) {
          const nextConversation = conversations[0] ?? groupConversations[0] ?? null;
          messagesRequestId += 1;
          set({
            conversations,
            groupConversations,
            archivedConversations,
            currentConversationId: nextConversation?.id ?? null,
            messages: [],
            isLoadingMessages: Boolean(nextConversation),
            targetMessageId: null,
          });
          if (nextConversation) await get().fetchMessages(nextConversation.id);
        } else {
          set({ conversations, groupConversations, archivedConversations });
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
        const allConversations = [
          ...state.conversations,
          ...state.groupConversations,
          ...state.archivedConversations,
        ];
        const deletedIndex = allConversations.findIndex((conversation) => conversation.id === id);
        const conversations = state.conversations.filter((conversation) => conversation.id !== id);
        const groupConversations = state.groupConversations.filter(
          (conversation) => conversation.id !== id,
        );
        const archivedConversations = state.archivedConversations.filter(
          (conversation) => conversation.id !== id,
        );

        if (state.currentConversationId !== id) {
          set({ conversations, groupConversations, archivedConversations });
          return true;
        }

        streamManager.clearStreamTimer();
        streamManager.abortFallback();
        messagesRequestId += 1;
        const activeConversations = [...conversations, ...groupConversations];
        const nextConversation =
          activeConversations[deletedIndex] ??
          activeConversations[deletedIndex - 1] ??
          activeConversations[0] ??
          null;

        set({
          conversations,
          groupConversations,
          archivedConversations,
          currentConversationId: nextConversation?.id ?? null,
          messages: [],
          a2aThreads: {},
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
        const groupConversations = state.groupConversations.filter(
          (item) => !deletedIds.has(item.id),
        );
        const archivedConversations = state.archivedConversations.filter(
          (item) => !deletedIds.has(item.id),
        );
        const currentWasDeleted = state.currentConversationId
          ? deletedIds.has(state.currentConversationId)
          : false;
        if (!currentWasDeleted) {
          set({ conversations, groupConversations, archivedConversations });
          return count;
        }
        streamManager.clearStreamTimer();
        streamManager.abortFallback();
        messagesRequestId += 1;
        const nextConversation = conversations[0] ?? groupConversations[0] ?? null;
        set({
          conversations,
          groupConversations,
          archivedConversations,
          currentConversationId: nextConversation?.id ?? null,
          messages: [],
          a2aThreads: {},
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
