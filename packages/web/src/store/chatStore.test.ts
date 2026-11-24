import type { Agent, Conversation, Message } from "@chorus/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: {
    getConversations: vi.fn(),
    getMessages: vi.fn(),
    sendMessage: vi.fn(),
    createConversation: vi.fn(),
    createHubRoom: vi.fn(),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
  },
  notFoundHandler: { current: null as ((conversationId: string) => void) | null },
  agentState: { agents: [] as Agent[], selectedAgentId: null as string | null },
  addToast: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/services/api", () => ({
  api: mocks.api,
  registerConversationNotFoundHandler: (handler: (conversationId: string) => void) => {
    mocks.notFoundHandler.current = handler;
  },
}));
vi.mock("@/store/agentStore", () => ({
  useAgentStore: { getState: () => mocks.agentState },
}));
vi.mock("@/store/uiStore", () => ({
  useUIStore: { getState: () => ({ addToast: mocks.addToast }) },
}));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/utils/logger", () => ({ logger: { error: mocks.loggerError } }));

import { STREAM_TIMEOUT_MS } from "./streamManager";
import { type A2AThreadState, useChatStore } from "./chatStore";

const { api, agentState, addToast } = mocks;
const initialState = useChatStore.getState();

function conversation(id: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id,
    title: id,
    type: "dm",
    a2aMode: "mention",
    agentIds: ["agent-1"],
    pinned: false,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Conversation;
}

function message(id: string, overrides: Partial<Message> = {}): Message {
  return {
    id,
    conversationId: "c1",
    fromType: "agent",
    fromId: "agent-1",
    content: "",
    timestamp: 1,
    status: "done",
    ...overrides,
  };
}

function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return { id, status: "online", ownerType: "local", ...overrides } as Agent;
}

function thread(threadId: string, overrides: Partial<A2AThreadState> = {}): A2AThreadState {
  return {
    threadId,
    conversationId: "c1",
    from: "agent-1",
    to: "agent-2",
    message: "hi",
    result: "",
    status: "running",
    startedAt: 1,
    ...overrides,
  };
}

/** Resolve getConversations by the (archived, type) arguments it was called with. */
function serveConversations(lists: {
  dm?: Conversation[];
  group?: Conversation[];
  cross_hub?: Conversation[];
  archived?: Conversation[];
}) {
  api.getConversations.mockImplementation(async (archived: boolean, type?: string) => {
    if (archived) return lists.archived ?? [];
    return lists[type as "dm" | "group" | "cross_hub"] ?? [];
  });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const store = () => useChatStore.getState();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  for (const fn of Object.values(api)) fn.mockReset();
  api.getConversations.mockResolvedValue([]);
  api.getMessages.mockResolvedValue([]);
  addToast.mockReset();
  mocks.loggerError.mockReset();
  agentState.agents = [agent("agent-1"), agent("agent-2")];
  agentState.selectedAgentId = null;
  useChatStore.setState(initialState, true);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("fetchConversations", () => {
  it("loads, sorts, and auto-selects the first DM", async () => {
    serveConversations({
      dm: [
        conversation("old", { updatedAt: 1 }),
        conversation("new", { updatedAt: 5 }),
        conversation("pinned", { pinned: true, updatedAt: 0 }),
      ],
      group: [conversation("g1", { type: "group" })],
      cross_hub: [conversation("x1", { type: "cross_hub", updatedAt: 9 })],
      archived: [conversation("a1", { archived: true })],
    });

    await store().fetchConversations();

    expect(api.getConversations).toHaveBeenCalledWith(false, "dm", true);
    expect(api.getConversations).toHaveBeenCalledWith(false, "group", true);
    expect(api.getConversations).toHaveBeenCalledWith(false, "cross_hub", true);
    expect(api.getConversations).toHaveBeenCalledWith(true, undefined, true);
    const state = store();
    expect(state.conversations.map((c) => c.id)).toEqual(["pinned", "new", "old"]);
    expect(state.groupConversations.map((c) => c.id)).toEqual(["x1", "g1"]);
    expect(state.archivedConversations.map((c) => c.id)).toEqual(["a1"]);
    expect(state).toMatchObject({ hasLoadedConversations: true, conversationsError: null });
    // Auto-select uses server order, not the sorted list.
    expect(state.currentConversationId).toBe("old");
    expect(api.getMessages).toHaveBeenCalledWith("old", true);
  });

  it("falls back to the first group when there are no DMs", async () => {
    serveConversations({ group: [conversation("g1", { type: "group" })] });
    await store().fetchConversations();
    expect(store().currentConversationId).toBe("g1");
  });

  it("skips the archived request when includeArchived is false", async () => {
    await store().fetchConversations(false);
    expect(api.getConversations).toHaveBeenCalledTimes(3);
    expect(api.getConversations).not.toHaveBeenCalledWith(true, undefined, true);
    expect(store().hasLoadedConversations).toBe(true);
  });

  it("keeps the current selection when it still exists", async () => {
    serveConversations({ dm: [conversation("c1"), conversation("c2")] });
    useChatStore.setState({ currentConversationId: "c2" });
    await store().fetchConversations();
    expect(store().currentConversationId).toBe("c2");
    expect(api.getMessages).not.toHaveBeenCalled();
  });

  it("purges the open conversation when the server no longer returns it", async () => {
    useChatStore.setState({
      conversations: [conversation("gone"), conversation("c1")],
      currentConversationId: "gone",
    });
    serveConversations({ dm: [conversation("c1")] });

    await store().fetchConversations();
    await flush();

    expect(store().currentConversationId).toBe("c1");
    expect(store().conversations.map((c) => c.id)).toEqual(["c1"]);
    expect(api.getMessages).toHaveBeenCalledWith("c1", true);
  });

  it("marks loaded with an error and keeps the old lists on failure", async () => {
    useChatStore.setState({ conversations: [conversation("c1")] });
    api.getConversations.mockRejectedValue(new Error("offline"));

    await store().fetchConversations();

    expect(store()).toMatchObject({
      hasLoadedConversations: true,
      conversationsError: "sidebar:conversationLoadFailed",
    });
    expect(store().conversations.map((c) => c.id)).toEqual(["c1"]);
  });

  it("clears a previous error at the start of a retry", async () => {
    useChatStore.setState({ conversationsError: "old" });
    const pending = deferred<Conversation[]>();
    api.getConversations.mockReturnValue(pending.promise);

    const request = store().fetchConversations();
    expect(store().conversationsError).toBeNull();
    pending.resolve([]);
    await request;
    expect(store().conversationsError).toBeNull();
  });
});

describe("conversation navigation", () => {
  it("setCurrentConversation resets per-conversation state and loads messages", () => {
    useChatStore.setState({
      currentConversationId: "c1",
      messages: [message("m1")],
      a2aThreads: { t1: thread("t1") },
      a2aConfirmations: [{ threadId: "t1", from: "a", to: "b", message: "", expiresAt: 0 }],
      messagesError: "boom",
    });

    store().setCurrentConversation("c2");

    expect(store()).toMatchObject({
      currentConversationId: "c2",
      messages: [],
      a2aThreads: {},
      a2aConfirmations: [],
      isLoadingMessages: true,
      messagesError: null,
    });
    expect(api.getMessages).toHaveBeenCalledWith("c2", true);
  });

  it("setCurrentConversation stops the previous conversation's stream", async () => {
    useChatStore.setState({ conversations: [conversation("c1")], currentConversationId: "c1" });
    const send = vi.fn(() => true);
    store().setWebSocketSend(send);
    await store().sendMessage("hello");
    store().addMessage(message("a1", { status: "streaming" }));
    expect(store().isStreaming).toBe(true);

    store().setCurrentConversation("c2");
    expect(store()).toMatchObject({ isStreaming: false, streamingMessageId: null });

    // The old stream timer must not fire into the new conversation.
    await vi.advanceTimersByTimeAsync(STREAM_TIMEOUT_MS);
    expect(addToast).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(store().isStreaming).toBe(false);
  });

  it("setCurrentConversation aborts an in-flight REST send", async () => {
    useChatStore.setState({ conversations: [conversation("c1")], currentConversationId: "c1" });
    let signal: AbortSignal | undefined;
    api.sendMessage.mockImplementation(
      (_id: string, _content: string, s: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal = s;
          s.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );

    const sending = store().sendMessage("hello");
    await flush();
    store().setCurrentConversation("c2");
    await sending;

    expect(signal?.aborted).toBe(true);
    expect(store()).toMatchObject({ currentConversationId: "c2", isStreaming: false });
  });

  it("setCurrentConversation is a no-op for the already open conversation", () => {
    useChatStore.setState({ currentConversationId: "c1", messages: [message("m1")] });
    store().setCurrentConversation("c1");
    expect(store().messages).toHaveLength(1);
    expect(api.getMessages).not.toHaveBeenCalled();
  });

  it("navigateToConversation clears the target message even when staying put", () => {
    useChatStore.setState({ currentConversationId: "c1", targetMessageId: "m1" });
    store().navigateToConversation("c1");
    expect(store().targetMessageId).toBeNull();
    expect(api.getMessages).not.toHaveBeenCalled();

    store().navigateToConversation("c2");
    expect(store().currentConversationId).toBe("c2");
  });

  it("navigateToMessage sets the target and switches only when needed", () => {
    useChatStore.setState({ currentConversationId: "c1" });
    store().navigateToMessage("c1", "m1");
    expect(store()).toMatchObject({ currentConversationId: "c1", targetMessageId: "m1" });
    expect(api.getMessages).not.toHaveBeenCalled();

    store().navigateToMessage("c2", "m2");
    expect(store()).toMatchObject({ currentConversationId: "c2", targetMessageId: "m2" });
    expect(api.getMessages).toHaveBeenCalledWith("c2", true);

    store().clearTargetMessage();
    expect(store().targetMessageId).toBeNull();
  });
});

describe("fetchMessages", () => {
  it("loads messages and clears the loading/error flags", async () => {
    useChatStore.setState({ currentConversationId: "c1", messagesError: "old" });
    api.getMessages.mockResolvedValue([message("m2", { timestamp: 2 }), message("m1")]);

    const pending = store().fetchMessages("c1");
    expect(store()).toMatchObject({ isLoadingMessages: true, messagesError: null });
    await pending;

    expect(store().messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(store()).toMatchObject({ isLoadingMessages: false, messagesError: null });
  });

  it("sets messagesError on failure", async () => {
    useChatStore.setState({ currentConversationId: "c1" });
    api.getMessages.mockRejectedValue(new Error("offline"));
    await store().fetchMessages("c1");
    expect(store()).toMatchObject({
      messagesError: "chat:messageLoadFailed",
      isLoadingMessages: false,
    });
  });

  it("keeps transient messages the server has not stored yet", async () => {
    useChatStore.setState({
      currentConversationId: "c1",
      messages: [
        message("persisted", { status: "done", timestamp: 1 }),
        message("optimistic", { status: "sending", timestamp: 5 }),
        message("streaming", { status: "streaming", timestamp: 6 }),
        message("thinking", { status: "thinking", timestamp: 7 }),
        message("stale-done", { status: "done", timestamp: 8 }),
        message("dup", { status: "sending", timestamp: 9 }),
      ],
    });
    api.getMessages.mockResolvedValue([
      message("server", { timestamp: 3 }),
      message("dup", { status: "done", timestamp: 9 }),
    ]);

    await store().fetchMessages("c1");

    expect(store().messages.map((m) => [m.id, m.status])).toEqual([
      ["server", "done"],
      ["optimistic", "sending"],
      ["streaming", "streaming"],
      ["thinking", "thinking"],
      ["dup", "done"],
    ]);
  });

  it("keeps A2A threads only while one is still running", async () => {
    useChatStore.setState({
      currentConversationId: "c1",
      a2aThreads: { t1: thread("t1", { status: "completed" }) },
    });
    await store().fetchMessages("c1");
    expect(store().a2aThreads).toEqual({});

    const running = { t1: thread("t1"), t2: thread("t2", { status: "error" }) };
    useChatStore.setState({ a2aThreads: running });
    await store().fetchMessages("c1");
    expect(store().a2aThreads).toEqual(running);
  });

  it("ignores a stale response superseded by a newer request", async () => {
    useChatStore.setState({ currentConversationId: "c1" });
    const first = deferred<Message[]>();
    api.getMessages.mockReturnValueOnce(first.promise).mockResolvedValueOnce([message("new")]);

    const stale = store().fetchMessages("c1");
    await store().fetchMessages("c1");
    first.resolve([message("old")]);
    await stale;

    expect(store().messages.map((m) => m.id)).toEqual(["new"]);
    expect(store().isLoadingMessages).toBe(false);
  });

  it("ignores responses and errors for a conversation that is no longer open", async () => {
    useChatStore.setState({ currentConversationId: "c1" });
    const pending = deferred<Message[]>();
    api.getMessages.mockReturnValueOnce(pending.promise);

    const request = store().fetchMessages("c1");
    useChatStore.setState({ currentConversationId: "c2", isLoadingMessages: true });
    pending.reject(new Error("offline"));
    await request;

    expect(store()).toMatchObject({ messagesError: null, isLoadingMessages: true });
  });

  it("does not flip loading state when fetching a background conversation", async () => {
    useChatStore.setState({ currentConversationId: "c1" });
    api.getMessages.mockResolvedValue([message("x", { conversationId: "c2" })]);
    await store().fetchMessages("c2");
    expect(store()).toMatchObject({ isLoadingMessages: false, messages: [] });
  });
});

describe("markTyping", () => {
  it("stamps and refreshes the typing timestamp", () => {
    store().markTyping("agent-1", true);
    expect(store().typingAgents).toEqual({ "agent-1": 1_000 });

    vi.setSystemTime(2_000);
    store().markTyping("agent-1", true);
    store().markTyping("agent-2", true);
    expect(store().typingAgents).toEqual({ "agent-1": 2_000, "agent-2": 2_000 });
  });

  it("removes only the agent that stopped typing", () => {
    useChatStore.setState({ typingAgents: { "agent-1": 1, "agent-2": 2 } });
    store().markTyping("agent-1", false);
    expect(store().typingAgents).toEqual({ "agent-2": 2 });
  });

  it("leaves state untouched when an unknown agent stops typing", () => {
    const typingAgents = { "agent-1": 1 };
    useChatStore.setState({ typingAgents });
    store().markTyping("agent-9", false);
    expect(store().typingAgents).toBe(typingAgents);
  });
});

describe("sendMessage", () => {
  function openConversation(conv: Conversation) {
    useChatStore.setState({ conversations: [conv], currentConversationId: conv.id });
  }

  it("is a no-op without an open conversation or with blank content", async () => {
    const send = vi.fn(() => true);
    useChatStore.setState({ webSocketSend: send });
    await store().sendMessage("hello");
    openConversation(conversation("c1"));
    await store().sendMessage("   ");
    expect(send).not.toHaveBeenCalled();
    expect(store().messages).toEqual([]);
  });

  it("adds an optimistic message and sends a DM over the socket", async () => {
    openConversation(conversation("c1"));
    const send = vi.fn(() => true);
    store().setWebSocketSend(send);

    await store().sendMessage("  hello  ", ["agent-1"]);

    const [userMsg] = store().messages;
    expect(userMsg).toMatchObject({
      conversationId: "c1",
      fromType: "user",
      toId: "agent-1",
      content: "hello",
      status: "sending",
      timestamp: 1_000,
    });
    expect(store().isStreaming).toBe(true);
    // DM mentions are not forwarded as A2A hints.
    expect(send).toHaveBeenCalledWith({
      type: "message",
      conversationId: "c1",
      clientMessageId: userMsg.id,
      content: "hello",
      agentId: "agent-1",
      mentionedAgents: undefined,
    });
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("times out the optimistic message if no reply arrives", async () => {
    openConversation(conversation("c1"));
    store().setWebSocketSend(() => true);
    await store().sendMessage("hello");

    await vi.advanceTimersByTimeAsync(STREAM_TIMEOUT_MS);

    expect(store().messages[0].status).toBe("error");
    expect(store().isStreaming).toBe(false);
    expect(addToast).toHaveBeenCalledWith("errors:agentTimeout", "error");
  });

  it("toasts and does nothing when the DM agent is unavailable", async () => {
    openConversation(conversation("c1"));
    agentState.agents = [agent("agent-1", { status: "offline" } as Partial<Agent>)];
    const send = vi.fn(() => true);
    store().setWebSocketSend(send);

    await store().sendMessage("hello");

    expect(addToast).toHaveBeenCalledWith("errors:agentUnavailable", "error");
    expect(store().messages).toEqual([]);
    expect(store().isStreaming).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["stale", { stale: true }, false],
    ["busy", { status: "busy" }, true],
    ["offline remote", { status: "offline", ownerType: "remote" }, true],
  ])("treats a %s agent as routable=%s", async (_label, overrides, routable) => {
    openConversation(conversation("c1"));
    agentState.agents = [agent("agent-1", overrides as Partial<Agent>)];
    store().setWebSocketSend(() => true);
    await store().sendMessage("hello");
    expect(store().messages).toHaveLength(routable ? 1 : 0);
  });

  it("routes a group message to the first online member and forwards mentions", async () => {
    openConversation(
      conversation("g1", { type: "group", agentIds: ["agent-1", "agent-2", "agent-3"] }),
    );
    agentState.agents = [
      agent("agent-1", { status: "offline" } as Partial<Agent>),
      agent("agent-2"),
    ];
    const send = vi.fn(() => true);
    store().setWebSocketSend(send);

    await store().sendMessage("hi", ["agent-3", "agent-3", "outsider"]);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-2", mentionedAgents: ["agent-3"] }),
    );
  });

  it("routes a group message to the selected agents that are members", async () => {
    openConversation(conversation("g1", { type: "cross_hub", agentIds: ["agent-1", "agent-2"] }));
    const send = vi.fn(() => true);
    store().setWebSocketSend(send);

    await store().sendMessage("hi", [], ["outsider", "agent-2"]);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ agentId: "agent-2" }));
  });

  it("refuses a group message when no selected agent is routable", async () => {
    openConversation(conversation("g1", { type: "group", agentIds: ["agent-1", "agent-2"] }));
    agentState.agents = [agent("agent-1"), agent("agent-2", { stale: true })];
    store().setWebSocketSend(() => true);

    await store().sendMessage("hi", [], ["agent-2"]);

    expect(addToast).toHaveBeenCalledWith("errors:agentUnavailable", "error");
    expect(store().messages).toEqual([]);
  });

  it("falls back to REST when the socket is not injected", async () => {
    openConversation(conversation("c1"));
    api.sendMessage.mockResolvedValue(message("server"));
    api.getMessages.mockResolvedValue([message("server-user", { fromType: "user" })]);

    await store().sendMessage("hello");

    expect(api.sendMessage).toHaveBeenCalledWith(
      "c1",
      "hello",
      expect.any(AbortSignal),
      "agent-1",
      undefined,
    );
    expect(api.getMessages).toHaveBeenCalledWith("c1", true);
    expect(store()).toMatchObject({ isStreaming: false, streamingMessageId: null });
    expect(store().messages.some((m) => m.id === "server-user")).toBe(true);
    // The REST success path clears the stream timer.
    await vi.advanceTimersByTimeAsync(STREAM_TIMEOUT_MS);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("does not duplicate the user message after a REST send", async () => {
    openConversation(conversation("c1"));
    api.sendMessage.mockResolvedValue(message("server"));
    api.getMessages.mockResolvedValue([
      message("server-user", { fromType: "user", fromId: "user", content: "hello" }),
    ]);

    await store().sendMessage("hello");

    expect(
      store()
        .messages.filter((m) => m.fromType === "user")
        .map((m) => m.id),
    ).toEqual(["server-user"]);
  });

  it("keeps the optimistic copy when the server list has no new matching message", async () => {
    // An identical message already in history must not count as the stored copy.
    useChatStore.setState({
      conversations: [conversation("c1")],
      currentConversationId: "c1",
      messages: [message("old-user", { fromType: "user", content: "hello" })],
    });
    api.sendMessage.mockResolvedValue(message("server"));
    api.getMessages.mockResolvedValue([
      message("old-user", { fromType: "user", content: "hello" }),
    ]);

    await store().sendMessage("hello");

    expect(store().messages.filter((m) => m.fromType === "user")).toHaveLength(2);
  });

  it("falls back to REST when the socket refuses the event", async () => {
    openConversation(conversation("c1"));
    store().setWebSocketSend(() => false);
    api.sendMessage.mockResolvedValue(message("server"));
    await store().sendMessage("hello");
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("marks the optimistic message as errored when the REST send fails", async () => {
    openConversation(conversation("c1"));
    api.sendMessage.mockRejectedValue(new Error("offline"));

    await store().sendMessage("hello");

    expect(store().messages).toHaveLength(1);
    expect(store().messages[0].status).toBe("error");
    expect(store()).toMatchObject({ isStreaming: false, streamingMessageId: null });
    expect(api.getMessages).not.toHaveBeenCalled();
  });

  it("leaves state to the canceller when the REST send is aborted", async () => {
    openConversation(conversation("c1"));
    let signal: AbortSignal | undefined;
    api.sendMessage.mockImplementation(
      (_id: string, _content: string, s: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal = s;
          s.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );

    const pending = store().sendMessage("hello");
    await flush();
    store().cancelStream();
    await pending;

    expect(signal?.aborted).toBe(true);
    expect(store().messages[0].status).toBe("sending");
    expect(store().isStreaming).toBe(false);
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });
});

describe("A2A threads", () => {
  const start = (threadId = "t1") =>
    store().startA2AThread({
      threadId,
      conversationId: "c1",
      from: "agent-1",
      to: "agent-2",
      message: "hi",
    });

  it("starts a running thread", () => {
    start();
    expect(store().a2aThreads.t1).toMatchObject({
      status: "running",
      result: "",
      startedAt: 1_000,
    });
  });

  it("restarting a running thread keeps its result and start time", () => {
    useChatStore.setState({
      a2aThreads: { t1: thread("t1", { result: "partial", startedAt: 5 }) },
    });
    start();
    expect(store().a2aThreads.t1).toMatchObject({ result: "partial", startedAt: 5 });
  });

  it.each(["completed", "error"] as const)("does not resurrect a %s thread", (status) => {
    const finished = thread("t1", { status });
    useChatStore.setState({ a2aThreads: { t1: finished } });
    start();
    expect(store().a2aThreads.t1).toBe(finished);
  });

  it("completes a thread and clears any prior error", () => {
    useChatStore.setState({ a2aThreads: { t1: thread("t1", { error: "old" }) } });
    vi.setSystemTime(2_000);
    store().completeA2AThread("t1", "done!");
    expect(store().a2aThreads.t1).toMatchObject({
      status: "completed",
      result: "done!",
      error: undefined,
      completedAt: 2_000,
    });
  });

  it("fails a thread", () => {
    start();
    store().failA2AThread("t1", "nope");
    expect(store().a2aThreads.t1).toMatchObject({
      status: "error",
      error: "nope",
      completedAt: 1_000,
    });
  });

  it("merges delivery updates", () => {
    start();
    store().updateA2ADelivery("t1", { transport: "queued" });
    store().updateA2ADelivery("t1", { execution: "accepted" });
    store().updateA2ADelivery("t1", { transport: "delivered" });
    expect(store().a2aThreads.t1.delivery).toEqual({
      transport: "delivered",
      execution: "accepted",
    });
  });

  it("ignores updates for unknown threads", () => {
    const before = store().a2aThreads;
    store().completeA2AThread("nope", "x");
    store().failA2AThread("nope", "x");
    store().updateA2ADelivery("nope", { transport: "failed" });
    expect(store().a2aThreads).toBe(before);
  });

  it("cancel sends a cancel event and fails the thread", () => {
    const send = vi.fn(() => true);
    store().setWebSocketSend(send);
    start();
    store().cancelA2AThread("t1");
    expect(send).toHaveBeenCalledWith({ type: "cancel", messageId: "t1" });
    expect(store().a2aThreads.t1).toMatchObject({ status: "error", error: "chat:a2aCancelled" });
  });

  it("cancel still fails the thread without a socket", () => {
    start();
    store().cancelA2AThread("t1");
    expect(store().a2aThreads.t1.status).toBe("error");
  });
});

describe("A2A confirmations", () => {
  const confirmation = (threadId: string, message = "m") => ({
    threadId,
    from: "agent-1",
    to: "agent-2",
    message,
    expiresAt: 10,
  });

  it("queues confirmations, deduplicating by thread", () => {
    store().requestA2AConfirmation(confirmation("t1", "first"));
    store().requestA2AConfirmation(confirmation("t2"));
    store().requestA2AConfirmation(confirmation("t1", "second"));
    expect(store().a2aConfirmations.map((c) => [c.threadId, c.message])).toEqual([
      ["t1", "first"],
      ["t2", "m"],
    ]);
  });

  it("dismisses by thread id", () => {
    store().requestA2AConfirmation(confirmation("t1"));
    store().requestA2AConfirmation(confirmation("t2"));
    store().dismissA2AConfirmation("t1");
    store().dismissA2AConfirmation("missing");
    expect(store().a2aConfirmations.map((c) => c.threadId)).toEqual(["t2"]);
  });
});

describe("createConversation", () => {
  it("reuses the open empty conversation for the same agent", async () => {
    const existing = conversation("c1");
    useChatStore.setState({ conversations: [existing], currentConversationId: "c1" });
    expect(await store().createConversation(undefined, "agent-1")).toBe(existing);
    expect(api.createConversation).not.toHaveBeenCalled();
  });

  it("creates a new conversation when the open one has messages", async () => {
    useChatStore.setState({
      conversations: [conversation("c1")],
      currentConversationId: "c1",
      messages: [message("m1")],
    });
    api.createConversation.mockResolvedValue(conversation("c2", { updatedAt: 9 }));

    await store().createConversation("t", "agent-1");

    expect(api.createConversation).toHaveBeenCalledWith("t", "agent-1", "dm", true);
    expect(store().conversations.map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(store()).toMatchObject({
      currentConversationId: "c2",
      messages: [],
      isLoadingMessages: false,
    });
  });

  it("resets stream and per-conversation state for the new conversation", async () => {
    useChatStore.setState({
      conversations: [conversation("c1")],
      currentConversationId: "c1",
      messages: [message("a1", { status: "streaming" })],
      isStreaming: true,
      streamingMessageId: "a1",
      messagesError: "boom",
      a2aThreads: { t1: thread("t1") },
      a2aConfirmations: [{ threadId: "t1", from: "a", to: "b", message: "", expiresAt: 0 }],
    });
    store().noteStreamActivity("a1");
    api.createConversation.mockResolvedValue(conversation("c2"));

    await store().createConversation("t", "agent-1");

    expect(store()).toMatchObject({
      currentConversationId: "c2",
      messages: [],
      isStreaming: false,
      streamingMessageId: null,
      messagesError: null,
      a2aThreads: {},
      a2aConfirmations: [],
    });
    await vi.advanceTimersByTimeAsync(STREAM_TIMEOUT_MS);
    expect(addToast).not.toHaveBeenCalled();
  });

  it("defaults to the selected agent and files non-DM types as groups", async () => {
    agentState.selectedAgentId = "agent-2";
    api.createConversation.mockResolvedValue(conversation("g1", { type: "group" }));

    await store().createConversation(undefined, undefined, "group");

    expect(api.createConversation).toHaveBeenCalledWith(undefined, "agent-2", "group", true);
    expect(store().groupConversations.map((c) => c.id)).toEqual(["g1"]);
    expect(store().conversations).toEqual([]);
  });

  it("returns null on failure", async () => {
    api.createConversation.mockRejectedValue(new Error("boom"));
    expect(await store().createConversation()).toBeNull();
    expect(store().currentConversationId).toBeNull();
  });
});

describe("createGroupConversation", () => {
  it("creates a local group", async () => {
    api.createConversation.mockResolvedValue(conversation("g1", { type: "group" }));
    await store().createGroupConversation("team", ["agent-1", "agent-2"]);
    expect(api.createConversation).toHaveBeenCalledWith(
      "team",
      ["agent-1", "agent-2"],
      "group",
      true,
    );
    expect(store()).toMatchObject({ currentConversationId: "g1", messages: [] });
    expect(store().groupConversations.map((c) => c.id)).toEqual(["g1"]);
  });

  it("creates a cross-hub group when a remote agent is included", async () => {
    agentState.agents = [agent("agent-1"), agent("remote-1", { ownerType: "remote" })];
    api.createConversation.mockResolvedValue(conversation("x1", { type: "cross_hub" }));
    await store().createGroupConversation("team", ["agent-1", "remote-1"]);
    expect(api.createConversation).toHaveBeenCalledWith(
      "team",
      ["agent-1", "remote-1"],
      "cross_hub",
      true,
    );
  });

  it("returns null on failure", async () => {
    api.createConversation.mockRejectedValue(new Error("boom"));
    expect(await store().createGroupConversation("team", [])).toBeNull();
  });
});

describe("createRoom", () => {
  it("refreshes conversations and opens the room's conversation", async () => {
    useChatStore.setState({ conversations: [conversation("c1")], currentConversationId: "c1" });
    api.createHubRoom.mockResolvedValue({ roomId: "room-1" });
    serveConversations({
      dm: [conversation("c1")],
      cross_hub: [conversation("x1", { type: "cross_hub", relayRoomId: "room-1" })],
    });

    expect(await store().createRoom("Room")).toBe(true);
    expect(api.createHubRoom).toHaveBeenCalledWith("Room", true);
    expect(store().currentConversationId).toBe("x1");
  });

  it("returns false when room creation fails", async () => {
    api.createHubRoom.mockRejectedValue(new Error("relay down"));
    expect(await store().createRoom("Room")).toBe(false);
    expect(api.getConversations).not.toHaveBeenCalled();
  });
});

describe("conversation mutations", () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [conversation("c1", { updatedAt: 2 }), conversation("c2", { updatedAt: 1 })],
      groupConversations: [conversation("g1", { type: "group" })],
      archivedConversations: [conversation("a1", { archived: true })],
      currentConversationId: "c1",
    });
  });

  it("syncConversation replaces matching items in every list", () => {
    store().syncConversation(conversation("a1", { archived: true, title: "renamed" }));
    store().syncConversation(conversation("missing"));
    expect(store().archivedConversations[0].title).toBe("renamed");
    expect(store().conversations.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  describe("renameConversation", () => {
    it("trims and applies the server result", async () => {
      api.updateConversation.mockResolvedValue(conversation("c2", { title: "New" }));
      expect(await store().renameConversation("c2", "  New  ")).toBe(true);
      expect(api.updateConversation).toHaveBeenCalledWith("c2", { title: "New" }, true);
      expect(store().conversations[1].title).toBe("New");
      expect(store().pendingConversationActions).toEqual({});
    });

    it("rejects a blank title without calling the API", async () => {
      expect(await store().renameConversation("c1", "   ")).toBe(false);
      expect(api.updateConversation).not.toHaveBeenCalled();
    });

    it("returns false and releases the lock on failure", async () => {
      api.updateConversation.mockRejectedValue(new Error("boom"));
      expect(await store().renameConversation("c1", "x")).toBe(false);
      expect(store().pendingConversationActions).toEqual({});
    });
  });

  it("blocks concurrent mutations on the same conversation", async () => {
    const pending = deferred<Conversation>();
    api.updateConversation.mockReturnValueOnce(pending.promise);

    const rename = store().renameConversation("c1", "x");
    expect(store().pendingConversationActions).toEqual({ c1: "rename" });
    expect(await store().togglePin("c1")).toBe(false);
    expect(await store().deleteConversation("c1")).toBe(false);
    expect(api.deleteConversation).not.toHaveBeenCalled();

    pending.resolve(conversation("c1", { title: "x" }));
    expect(await rename).toBe(true);
    expect(store().pendingConversationActions).toEqual({});
  });

  describe("togglePin", () => {
    it("flips pinned and re-sorts", async () => {
      api.updateConversation.mockResolvedValue(conversation("c2", { pinned: true, updatedAt: 1 }));
      expect(await store().togglePin("c2")).toBe(true);
      expect(api.updateConversation).toHaveBeenCalledWith("c2", { pinned: true }, true);
      expect(store().conversations.map((c) => c.id)).toEqual(["c2", "c1"]);
    });

    it("returns false for an unknown conversation and releases the lock", async () => {
      expect(await store().togglePin("missing")).toBe(false);
      expect(api.updateConversation).not.toHaveBeenCalled();
      expect(store().pendingConversationActions).toEqual({});
    });

    it("returns false on failure", async () => {
      api.updateConversation.mockRejectedValue(new Error("boom"));
      expect(await store().togglePin("c1")).toBe(false);
      expect(store().pendingConversationActions).toEqual({});
    });
  });

  describe("toggleArchive", () => {
    it("archives a background DM without changing the selection", async () => {
      api.updateConversation.mockResolvedValue(conversation("c2", { archived: true }));
      expect(await store().toggleArchive("c2")).toBe(true);
      expect(api.updateConversation).toHaveBeenCalledWith("c2", { archived: true }, true);
      expect(store().conversations.map((c) => c.id)).toEqual(["c1"]);
      expect(
        store()
          .archivedConversations.map((c) => c.id)
          .sort(),
      ).toEqual(["a1", "c2"]);
      expect(store().currentConversationId).toBe("c1");
    });

    it("unarchives into the DM or group list by type", async () => {
      api.updateConversation.mockResolvedValueOnce(conversation("a1", { updatedAt: 9 }));
      await store().toggleArchive("a1");
      expect(store().conversations[0].id).toBe("a1");
      expect(store().archivedConversations).toEqual([]);

      useChatStore.setState({
        archivedConversations: [conversation("ag", { type: "group", archived: true })],
      });
      api.updateConversation.mockResolvedValueOnce(conversation("ag", { type: "group" }));
      await store().toggleArchive("ag");
      expect(
        store()
          .groupConversations.map((c) => c.id)
          .sort(),
      ).toEqual(["ag", "g1"]);
    });

    it("moves away from the open conversation when it is archived", async () => {
      useChatStore.setState({ targetMessageId: "m1", messages: [message("m1")] });
      api.updateConversation.mockResolvedValue(conversation("c1", { archived: true }));
      api.getMessages.mockResolvedValue([message("m2", { conversationId: "c2" })]);

      expect(await store().toggleArchive("c1")).toBe(true);

      expect(store()).toMatchObject({
        currentConversationId: "c2",
        targetMessageId: null,
        isLoadingMessages: false,
      });
      expect(api.getMessages).toHaveBeenCalledWith("c2", true);
      expect(store().messages.map((m) => m.id)).toEqual(["m2"]);
    });

    it("stops the stream when archiving the open conversation", async () => {
      useChatStore.setState({
        messages: [message("a1", { status: "streaming" })],
        isStreaming: true,
        streamingMessageId: "a1",
      });
      store().noteStreamActivity("a1");
      api.updateConversation.mockResolvedValue(conversation("c1", { archived: true }));

      await store().toggleArchive("c1");

      expect(store()).toMatchObject({
        currentConversationId: "c2",
        isStreaming: false,
        streamingMessageId: null,
      });
      await vi.advanceTimersByTimeAsync(STREAM_TIMEOUT_MS);
      expect(addToast).not.toHaveBeenCalled();
    });

    it("clears the selection when archiving the last active conversation", async () => {
      useChatStore.setState({ conversations: [conversation("c1")], groupConversations: [] });
      api.updateConversation.mockResolvedValue(conversation("c1", { archived: true }));
      await store().toggleArchive("c1");
      expect(store()).toMatchObject({
        currentConversationId: null,
        messages: [],
        isLoadingMessages: false,
      });
      expect(api.getMessages).not.toHaveBeenCalled();
    });

    it("returns false for an unknown conversation or on failure", async () => {
      expect(await store().toggleArchive("missing")).toBe(false);
      api.updateConversation.mockRejectedValue(new Error("boom"));
      expect(await store().toggleArchive("c1")).toBe(false);
      expect(store().pendingConversationActions).toEqual({});
      expect(store().currentConversationId).toBe("c1");
    });
  });

  describe("deleteConversation", () => {
    it("removes a background conversation and keeps the selection", async () => {
      api.deleteConversation.mockResolvedValue(undefined);
      expect(await store().deleteConversation("a1")).toBe(true);
      expect(api.deleteConversation).toHaveBeenCalledWith("a1", true);
      expect(store().archivedConversations).toEqual([]);
      expect(store().currentConversationId).toBe("c1");
      expect(api.getMessages).not.toHaveBeenCalled();
    });

    it("selects the next conversation at the same position when deleting the open one", async () => {
      useChatStore.setState({
        messages: [message("m1")],
        a2aThreads: { t1: thread("t1") },
        isStreaming: true,
        streamingMessageId: "m1",
        targetMessageId: "m1",
      });
      api.deleteConversation.mockResolvedValue(undefined);

      expect(await store().deleteConversation("c1")).toBe(true);

      expect(store()).toMatchObject({
        currentConversationId: "c2",
        a2aThreads: {},
        isStreaming: false,
        streamingMessageId: null,
        targetMessageId: null,
        isLoadingMessages: false,
      });
      expect(api.getMessages).toHaveBeenCalledWith("c2", true);
    });

    it("falls back to the previous conversation when deleting the last item", async () => {
      useChatStore.setState({ currentConversationId: "g1" });
      api.deleteConversation.mockResolvedValue(undefined);
      await store().deleteConversation("g1");
      expect(store().currentConversationId).toBe("c2");
    });

    it("clears the selection when nothing is left", async () => {
      useChatStore.setState({
        conversations: [conversation("c1")],
        groupConversations: [],
        archivedConversations: [],
      });
      api.deleteConversation.mockResolvedValue(undefined);
      await store().deleteConversation("c1");
      expect(store()).toMatchObject({ currentConversationId: null, isLoadingMessages: false });
      expect(api.getMessages).not.toHaveBeenCalled();
    });

    it("keeps everything on failure", async () => {
      api.deleteConversation.mockRejectedValue(new Error("boom"));
      expect(await store().deleteConversation("c1")).toBe(false);
      expect(store().conversations.map((c) => c.id)).toEqual(["c1", "c2"]);
      expect(store().pendingConversationActions).toEqual({});
    });

    it("aborts an in-flight REST send when the open conversation is deleted", async () => {
      useChatStore.setState({ conversations: [conversation("c1"), conversation("c2")] });
      let signal: AbortSignal | undefined;
      api.sendMessage.mockImplementation(
        (_id: string, _content: string, s: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal = s;
            s.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
      api.deleteConversation.mockResolvedValue(undefined);

      const sending = store().sendMessage("hello");
      await flush();
      await store().deleteConversation("c1");
      await sending;

      expect(signal?.aborted).toBe(true);
      expect(store().currentConversationId).toBe("c2");
    });
  });

  describe("purgeConversation", () => {
    it("ignores unknown conversations", () => {
      const before = store();
      store().purgeConversation("missing");
      expect(store()).toBe(before);
    });

    it("drops the open conversation and loads the replacement", async () => {
      store().purgeConversation("c1");
      expect(store().currentConversationId).toBe("c2");
      expect(store().isLoadingMessages).toBe(true);
      await flush();
      expect(api.getMessages).toHaveBeenCalledWith("c2", true);
      expect(store().isLoadingMessages).toBe(false);
    });

    it("is wired to the API's conversation-not-found handler", () => {
      mocks.notFoundHandler.current?.("c2");
      expect(store().conversations.map((c) => c.id)).toEqual(["c1"]);
    });
  });

  describe("applyExternalMessage", () => {
    it("updates sidebar meta and re-sorts", () => {
      store().applyExternalMessage(
        "c2",
        message("m1", { conversationId: "c2", content: "ping", timestamp: 50 }),
      );
      expect(store().conversations.map((c) => c.id)).toEqual(["c2", "c1"]);
      expect(store().conversations[0]).toMatchObject({ lastMessage: "ping", updatedAt: 50 });
    });

    it("keeps the previous meta for empty content or timestamp", () => {
      useChatStore.setState({
        conversations: [conversation("c1", { lastMessage: "prev", updatedAt: 7 })],
      });
      store().applyExternalMessage("c1", message("m1", { content: "", timestamp: 0 }));
      expect(store().conversations[0]).toMatchObject({ lastMessage: "prev", updatedAt: 7 });
    });

    it("refetches conversations for an unknown conversation", async () => {
      store().applyExternalMessage("new", message("m1", { conversationId: "new" }));
      await flush();
      expect(api.getConversations).toHaveBeenCalled();
    });
  });
});

describe("stream delegation", () => {
  it("routes message/stream actions through the stream manager", () => {
    useChatStore.setState({ currentConversationId: "c1" });
    store().addMessage(message("a1", { status: "thinking" }));
    expect(store()).toMatchObject({ isStreaming: true, streamingMessageId: "a1" });

    store().appendStreamChunk("a1", "he");
    store().appendStreamChunk("a1", "llo");
    expect(store().messages[0]).toMatchObject({ content: "hello", status: "streaming" });

    store().noteStreamActivity("a1");
    store().setMessageStatus("a1", "done");
    expect(store()).toMatchObject({ isStreaming: false, streamingMessageId: null });
  });

  it("cancelStream sends a cancel and marks the stream partial", () => {
    const send = vi.fn(() => true);
    useChatStore.setState({ webSocketSend: send });
    store().addMessage(message("a1", { status: "streaming" }));
    store().cancelStream();
    expect(send).toHaveBeenCalledWith({ type: "cancel", messageId: "a1" });
    expect(store().messages[0].status).toBe("partial");
    expect(store().isStreaming).toBe(false);
  });
});
