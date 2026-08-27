import { create } from "zustand";
import type { ClientEvent, Conversation, ConversationType, Message } from "@chorus/shared";
import { api, registerConversationNotFoundHandler } from "@/services/api";
import { useAgentStore } from "@/store/agentStore";
import { StreamManager } from "@/store/streamManager";
import { useUIStore } from "@/store/uiStore";
import i18n from "@/i18n";
import { logger } from "@/utils/logger";

export type { Conversation, Message } from "@chorus/shared";

type WebSocketSend = (event: ClientEvent) => boolean;
type ConversationMutation = "rename" | "pin" | "archive" | "delete";

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
  delivery?: {
    transport?: "queued" | "delivered" | "failed";
    execution?: "accepted" | "denied" | "done" | "error";
  };
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
  hasLoadedConversations: boolean;
  conversationsError: string | null;
  currentConversationId: string | null;
  targetMessageId: string | null;
  /** agentId → timestamp of the most recent typing event (peer input indicator). */
  typingAgents: Record<string, number>;
  messages: Message[];
  isLoadingMessages: boolean;
  messagesError: string | null;
  isStreaming: boolean;
  streamingMessageId: string | null;
  a2aThreads: Record<string, A2AThreadState>;
  a2aConfirmations: A2AConfirmation[];
  webSocketSend: WebSocketSend | null;
  pendingConversationActions: Record<string, ConversationMutation>;

  fetchConversations: (includeArchived?: boolean) => Promise<void>;
  setCurrentConversation: (id: string) => void;
  navigateToConversation: (id: string) => void;
  navigateToMessage: (conversationId: string, messageId: string) => void;
  clearTargetMessage: () => void;
  fetchMessages: (conversationId: string) => Promise<void>;
  sendMessage: (
    content: string,
    mentionedAgentIds?: string[],
    routedAgentIds?: string[],
  ) => Promise<void>;
  appendStreamChunk: (messageId: string, chunk: string) => void;
  noteStreamActivity: (messageId: string) => void;
  setMessageStatus: (messageId: string, status: Message["status"]) => void;
  addMessage: (message: Message) => void;
  cancelStream: () => void;
  startA2AThread: (thread: Omit<A2AThreadState, "result" | "status" | "startedAt">) => void;
  completeA2AThread: (threadId: string, result: string) => void;
  failA2AThread: (threadId: string, error: string) => void;
  updateA2ADelivery: (threadId: string, update: NonNullable<A2AThreadState["delivery"]>) => void;
  cancelA2AThread: (threadId: string) => void;
  requestA2AConfirmation: (confirmation: A2AConfirmation) => void;
  dismissA2AConfirmation: (threadId: string) => void;
  setWebSocketSend: (send: WebSocketSend | null) => void;
  createConversation: (
    title?: string,
    agentId?: string,
    type?: ConversationType,
  ) => Promise<Conversation | null>;
  createGroupConversation: (title: string, agentIds: string[]) => Promise<Conversation | null>;
  createRoom: (name: string) => Promise<boolean>;
  markTyping: (agentId: string, isTyping: boolean) => void;
  syncConversation: (conversation: Conversation) => void;
  renameConversation: (id: string, title: string) => Promise<boolean>;
  togglePin: (id: string) => Promise<boolean>;
  toggleArchive: (id: string) => Promise<boolean>;
  deleteConversation: (id: string) => Promise<boolean>;
  /** Drop a conversation deleted outside this client, navigating away if open. */
  purgeConversation: (id: string) => void;
  /** Sync sidebar meta for a message that arrived over WebSocket. */
  applyExternalMessage: (conversationId: string, message: Message) => void;
}

function sortConversations(items: Conversation[]): Conversation[] {
  return [...items].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
  );
}

export const useChatStore = create<ChatState>((set, get) => {
  let messagesRequestId = 0;
  const streamManager = new StreamManager(get, set);
  const beginConversationAction = (id: string, action: ConversationMutation) => {
    if (get().pendingConversationActions[id]) return false;
    set((state) => ({
      pendingConversationActions: { ...state.pendingConversationActions, [id]: action },
    }));
    return true;
  };
  const endConversationAction = (id: string) => {
    set((state) => ({
      pendingConversationActions: Object.fromEntries(
        Object.entries(state.pendingConversationActions).filter(
          ([conversationId]) => conversationId !== id,
        ),
      ),
    }));
  };
  /**
   * Shared removal path for delete/purge: drop the conversation from every
   * list, and when the currently open conversation is the one removed, reset
   * stream/navigate state and return its replacement (null if none). The
   * caller owns fetching the replacement's messages.
   */
  const dropConversation = (id: string): Conversation | null => {
    const state = get();
    const deletedIndex = [
      ...state.conversations,
      ...state.groupConversations,
      ...state.archivedConversations,
    ].findIndex((conversation) => conversation.id === id);
    const conversations = state.conversations.filter((conversation) => conversation.id !== id);
    const groupConversations = state.groupConversations.filter(
      (conversation) => conversation.id !== id,
    );
    const archivedConversations = state.archivedConversations.filter(
      (conversation) => conversation.id !== id,
    );

    if (state.currentConversationId !== id) {
      set({ conversations, groupConversations, archivedConversations });
      return null;
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
      targetMessageId: null,
    });
    return nextConversation;
  };

  return {
    conversations: [],
    typingAgents: {},
    groupConversations: [],
    archivedConversations: [],
    hasLoadedConversations: false,
    conversationsError: null,
    currentConversationId: null,
    targetMessageId: null,
    messages: [],
    isLoadingMessages: false,
    messagesError: null,
    isStreaming: false,
    streamingMessageId: null,
    a2aThreads: {},
    a2aConfirmations: [],
    webSocketSend: null,
    pendingConversationActions: {},

    fetchConversations: async (includeArchived = true) => {
      set({ conversationsError: null });
      try {
        const [data, groups, crossHubGroups, archived] = await Promise.all([
          api.getConversations(false, "dm", true),
          api.getConversations(false, "group", true),
          api.getConversations(false, "cross_hub", true),
          includeArchived ? api.getConversations(true, undefined, true) : Promise.resolve([]),
        ]);
        const allGroups = [...groups, ...crossHubGroups];
        set({
          conversations: sortConversations(data),
          groupConversations: sortConversations(allGroups),
          archivedConversations: sortConversations(archived),
          hasLoadedConversations: true,
          conversationsError: null,
        });
        // Auto-select first conversation if none selected
        const firstConversation = data[0] ?? allGroups[0];
        if (!get().currentConversationId && firstConversation) {
          get().setCurrentConversation(firstConversation.id);
        }
        // Reconcile: the open conversation may have been deleted outside this
        // client (e.g. another session using the REST API).
        const currentId = get().currentConversationId;
        if (
          currentId &&
          ![...data, ...allGroups, ...archived].some((item) => item.id === currentId)
        ) {
          get().purgeConversation(currentId);
        }
      } catch (e) {
        logger.error("Failed to fetch conversations", e);
        set({
          hasLoadedConversations: true,
          conversationsError: i18n.t("sidebar:conversationLoadFailed"),
        });
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
        messagesError: null,
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

    markTyping: (agentId, isTyping) =>
      set((state) => {
        const current = state.typingAgents[agentId];
        if (isTyping) {
          // Heartbeat-style refresh keeps the indicator alive during long streams.
          return { typingAgents: { ...state.typingAgents, [agentId]: Date.now() } };
        }
        if (current === undefined) return {};
        const next: Record<string, number> = {};
        for (const [id, timestamp] of Object.entries(state.typingAgents)) {
          if (id !== agentId) next[id] = timestamp;
        }
        return { typingAgents: next };
      }),

    fetchMessages: async (conversationId) => {
      const requestId = ++messagesRequestId;
      if (get().currentConversationId === conversationId) {
        set({ isLoadingMessages: true, messagesError: null });
      }
      try {
        const data = await api.getMessages(conversationId, true);
        if (requestId === messagesRequestId && get().currentConversationId === conversationId) {
          set((state) => {
            // The server list is authoritative for persisted messages, but a
            // REST fallback fetch mid-stream must not wipe optimistic sends or
            // in-flight streams the server has not stored yet.
            const serverIds = new Set(data.map((message) => message.id));
            const transient = state.messages.filter(
              (message) =>
                !serverIds.has(message.id) &&
                ["sending", "streaming", "thinking"].includes(message.status),
            );
            const hasRunningThread = Object.values(state.a2aThreads).some(
              (thread) => thread.status === "running",
            );
            return {
              messages: [...data, ...transient].sort((a, b) => a.timestamp - b.timestamp),
              a2aThreads: hasRunningThread ? state.a2aThreads : {},
              messagesError: null,
            };
          });
        }
      } catch (e) {
        logger.error("Failed to fetch messages", e);
        if (requestId === messagesRequestId && get().currentConversationId === conversationId) {
          set({ messagesError: i18n.t("chat:messageLoadFailed") });
        }
      } finally {
        if (requestId === messagesRequestId && get().currentConversationId === conversationId) {
          set({ isLoadingMessages: false });
        }
      }
    },

    sendMessage: async (content, mentionedAgentIds = [], routedAgentIds = []) => {
      const convId = get().currentConversationId;
      if (!convId) return;

      const trimmedContent = content.trim();
      if (!trimmedContent) return;

      const conversation = [
        ...get().conversations,
        ...get().groupConversations,
        ...get().archivedConversations,
      ].find((item) => item.id === convId);
      const isGroup = conversation?.type === "group" || conversation?.type === "cross_hub";
      // mentionedAgentIds = @mentions in text (A2A hints, NOT routing targets)
      // routedAgentIds = manually selected agents via AgentSelector (routing targets)
      const mentionIds = [...new Set(mentionedAgentIds)].filter((id) =>
        conversation?.agentIds.includes(id),
      );
      const routeIds = [...new Set(routedAgentIds)].filter((id) =>
        conversation?.agentIds.includes(id),
      );
      const availableAgents = useAgentStore.getState().agents;
      const isRoutable = (agentId: string) =>
        availableAgents.some(
          (agent) =>
            agent.id === agentId &&
            !agent.stale &&
            (agent.ownerType === "remote" || agent.status === "online" || agent.status === "busy"),
        );
      const firstOnlineAgentId = conversation?.agentIds.find(isRoutable);
      // For DM: route to the conversation's agent (or first selected)
      // For group: route to manually selected agents, or first online agent (NOT @mentioned)
      const activeAgentId = isGroup
        ? routeIds.length > 0
          ? routeIds[0]
          : firstOnlineAgentId
        : (routeIds[0] ?? conversation?.agentIds[0]);
      const routableAgentIds =
        isGroup && routeIds.length > 0
          ? routeIds.filter(isRoutable)
          : activeAgentId
            ? [activeAgentId].filter(isRoutable)
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
      streamManager.armStreamTimer(userMsg.id);

      // @mentions are A2A hints only, not routing targets
      const mentionedAgents = isGroup && mentionIds.length > 0 ? mentionIds : undefined;
      const sent = get().webSocketSend?.({
        type: "message",
        conversationId: convId,
        clientMessageId: userMsg.id,
        content: trimmedContent,
        agentId: activeAgentId,
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
          activeAgentId,
          mentionedAgents,
        );
        streamManager.clearStreamTimer();
        await get().fetchMessages(convId);
        set({ isStreaming: false, streamingMessageId: null });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          logger.error("Failed to send message", error);
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
      set((state) => {
        // A replayed tool_call_start (e.g. after reconnect replay) must not
        // resurrect a thread that already completed or failed.
        const existing = state.a2aThreads[thread.threadId];
        if (existing && existing.status !== "running") return {};
        return {
          a2aThreads: {
            ...state.a2aThreads,
            [thread.threadId]: {
              ...thread,
              result: existing?.result ?? "",
              status: "running",
              startedAt: existing?.startedAt ?? Date.now(),
            },
          },
        };
      }),

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

    updateA2ADelivery: (threadId, update) =>
      set((state) => {
        const thread = state.a2aThreads[threadId];
        if (!thread) return {};
        return {
          a2aThreads: {
            ...state.a2aThreads,
            [threadId]: {
              ...thread,
              delivery: { ...thread.delivery, ...update },
            },
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

    createConversation: async (title, agentId, type = "dm") => {
      const targetAgentId = agentId ?? useAgentStore.getState().selectedAgentId ?? undefined;
      const current = get();
      // Block only if: current is empty AND same agent (avoid duplicate empty convos)
      if (current.currentConversationId && current.messages.length === 0 && !current.isStreaming) {
        const conv = [...current.conversations, ...current.groupConversations].find(
          (c) => c.id === current.currentConversationId,
        );
        if (conv && (!targetAgentId || conv.agentIds.includes(targetAgentId))) {
          // Switch to the existing empty conversation instead of creating a new one
          if (conv.agentIds[0] === targetAgentId) return conv;
        }
      }

      try {
        const conv = await api.createConversation(title, targetAgentId, type, true);
        set((state) => ({
          conversations:
            conv.type === "dm"
              ? sortConversations([conv, ...state.conversations])
              : state.conversations,
          groupConversations:
            conv.type === "dm"
              ? state.groupConversations
              : sortConversations([conv, ...state.groupConversations]),
          currentConversationId: conv.id,
          messages: [],
          isLoadingMessages: false,
        }));
        return conv;
      } catch (e) {
        logger.error("Failed to create conversation", e);
        return null;
      }
    },

    createGroupConversation: async (title, agentIds) => {
      try {
        const containsRemoteAgent = useAgentStore
          .getState()
          .agents.some((agent) => agentIds.includes(agent.id) && agent.ownerType === "remote");
        const type: ConversationType = containsRemoteAgent ? "cross_hub" : "group";
        const conv = await api.createConversation(title, agentIds, type, true);
        set((state) => ({
          groupConversations: sortConversations([conv, ...state.groupConversations]),
          currentConversationId: conv.id,
          messages: [],
          isLoadingMessages: false,
        }));
        return conv;
      } catch (error) {
        logger.error("Failed to create group conversation", error);
        return null;
      }
    },

    createRoom: async (name) => {
      try {
        const room = await api.createHubRoom(name, true);
        await get().fetchConversations();
        const conversation = get().groupConversations.find(
          (item) => item.relayRoomId === room.roomId,
        );
        if (conversation) get().setCurrentConversation(conversation.id);
        return true;
      } catch (error) {
        logger.error("Failed to create Relay Room", error);
        return false;
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
      if (!beginConversationAction(id, "rename")) return false;
      try {
        const updated = await api.updateConversation(id, { title: trimmed }, true);
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
      } finally {
        endConversationAction(id);
      }
    },

    togglePin: async (id) => {
      if (!beginConversationAction(id, "pin")) return false;
      const state = get();
      const conversation = [
        ...state.conversations,
        ...state.groupConversations,
        ...state.archivedConversations,
      ].find((item) => item.id === id);
      if (!conversation) {
        endConversationAction(id);
        return false;
      }
      try {
        const updated = await api.updateConversation(id, { pinned: !conversation.pinned }, true);
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
        return true;
      } catch (error) {
        logger.error("Failed to pin conversation", error);
        return false;
      } finally {
        endConversationAction(id);
      }
    },

    toggleArchive: async (id) => {
      if (!beginConversationAction(id, "archive")) return false;
      const state = get();
      const conversation = [
        ...state.conversations,
        ...state.groupConversations,
        ...state.archivedConversations,
      ].find((item) => item.id === id);
      if (!conversation) {
        endConversationAction(id);
        return false;
      }
      try {
        const updated = await api.updateConversation(
          id,
          { archived: !conversation.archived },
          true,
        );
        const current = get();
        const conversations = sortConversations([
          ...current.conversations.filter((item) => item.id !== id),
          ...(!updated.archived && updated.type === "dm" ? [updated] : []),
        ]);
        const groupConversations = sortConversations([
          ...current.groupConversations.filter((item) => item.id !== id),
          ...(!updated.archived && updated.type !== "dm" ? [updated] : []),
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
        return true;
      } catch (error) {
        logger.error("Failed to archive conversation", error);
        return false;
      } finally {
        endConversationAction(id);
      }
    },

    deleteConversation: async (id) => {
      if (!beginConversationAction(id, "delete")) return false;
      try {
        await api.deleteConversation(id, true);
        const nextConversation = dropConversation(id);
        if (nextConversation) {
          await get().fetchMessages(nextConversation.id);
        }
        return true;
      } catch (e) {
        logger.error("Failed to delete conversation", e);
        return false;
      } finally {
        endConversationAction(id);
      }
    },

    /**
     * Remove a conversation that was deleted outside this client (e.g. via the
     * REST API from another session). Keeps list state consistent and navigates
     * away when the deleted conversation is currently open.
     */
    purgeConversation: (id) => {
      const state = get();
      const known = [
        ...state.conversations,
        ...state.groupConversations,
        ...state.archivedConversations,
      ].some((conversation) => conversation.id === id);
      if (!known) return;

      const nextConversation = dropConversation(id);
      if (nextConversation) {
        void get().fetchMessages(nextConversation.id);
      }
    },

    applyExternalMessage: (conversationId, message) => {
      const state = get();
      const isKnown = [
        ...state.conversations,
        ...state.groupConversations,
        ...state.archivedConversations,
      ].some((conversation) => conversation.id === conversationId);
      if (!isKnown) {
        // Conversation created outside this client (REST API / another session).
        void get().fetchConversations();
        return;
      }
      const refresh = (items: Conversation[]) =>
        sortConversations(
          items.map((conversation) =>
            conversation.id === conversationId
              ? {
                  ...conversation,
                  lastMessage: message.content || conversation.lastMessage,
                  updatedAt: message.timestamp || conversation.updatedAt,
                }
              : conversation,
          ),
        );
      set({
        conversations: refresh(state.conversations),
        groupConversations: refresh(state.groupConversations),
        archivedConversations: refresh(state.archivedConversations),
      });
    },
  };
});

// A conversation the server no longer knows about was deleted outside this
// client; purge it so views stop polling a dead id.
registerConversationNotFoundHandler((conversationId) => {
  useChatStore.getState().purgeConversation(conversationId);
});
