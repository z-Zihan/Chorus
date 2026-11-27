import type { ClientEvent, Message } from "@chorus/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { addToast, loggerError } = vi.hoisted(() => ({
  addToast: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));
vi.mock("@/store/uiStore", () => ({ useUIStore: { getState: () => ({ addToast }) } }));
vi.mock("@/utils/logger", () => ({ logger: { error: loggerError } }));

import { STREAM_TIMEOUT_MS, StreamManager } from "./streamManager";

interface TestState {
  messages: Message[];
  isStreaming: boolean;
  streamingMessageId: string | null;
  webSocketSend: ((event: ClientEvent) => boolean) | null;
}

function message(overrides: Partial<Message> & Pick<Message, "id">): Message {
  return {
    conversationId: "conv-1",
    fromType: "agent",
    fromId: "agent-1",
    content: "",
    timestamp: 1,
    status: "done",
    ...overrides,
  };
}

function setup(initial: Partial<TestState> = {}) {
  let state: TestState = {
    messages: [],
    isStreaming: false,
    streamingMessageId: null,
    webSocketSend: vi.fn(() => true),
    ...initial,
  };
  const manager = new StreamManager<TestState>(
    () => state,
    (updater) => {
      state = { ...state, ...updater(state) };
    },
  );
  return { manager, getState: () => state };
}

beforeEach(() => {
  vi.useFakeTimers();
  addToast.mockReset();
  loggerError.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StreamManager stream timeout", () => {
  it("does not fire before STREAM_TIMEOUT_MS and falls back exactly at the boundary", () => {
    const { manager, getState } = setup();
    const controller = new AbortController();
    manager.setFallbackController(controller);
    manager.addMessage(message({ id: "a1", status: "thinking" }));
    expect(getState()).toMatchObject({ isStreaming: true, streamingMessageId: "a1" });

    vi.advanceTimersByTime(STREAM_TIMEOUT_MS - 1);
    expect(getState().isStreaming).toBe(true);
    expect(getState().webSocketSend).not.toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(false);
    expect(addToast).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(getState().webSocketSend).toHaveBeenCalledWith({ type: "cancel", messageId: "a1" });
    expect(controller.signal.aborted).toBe(true);
    expect(getState()).toMatchObject({ isStreaming: false, streamingMessageId: null });
    expect(getState().messages[0].status).toBe("error");
    expect(addToast).toHaveBeenCalledWith("errors:agentTimeout", "error");
    expect(loggerError).toHaveBeenCalledWith("Agent response timed out", { messageId: "a1" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back to the armed message id when no streamingMessageId is set", () => {
    const { manager, getState } = setup({
      messages: [message({ id: "a1", status: "streaming" })],
      isStreaming: true,
    });
    manager.armStreamTimer("a1");

    vi.advanceTimersByTime(STREAM_TIMEOUT_MS);
    expect(getState().webSocketSend).not.toHaveBeenCalled();
    expect(getState().messages[0].status).toBe("error");
    expect(getState().isStreaming).toBe(false);
  });

  it("does nothing on timeout when the stream is no longer active", () => {
    const { manager, getState } = setup({ messages: [message({ id: "a1", status: "done" })] });
    manager.armStreamTimer("a1");

    vi.advanceTimersByTime(STREAM_TIMEOUT_MS);
    expect(getState().messages[0].status).toBe("done");
    expect(getState().webSocketSend).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timer when the primary stream completes normally", () => {
    const { manager, getState } = setup();
    manager.addMessage(message({ id: "a1", status: "thinking" }));
    expect(vi.getTimerCount()).toBe(1);

    manager.addMessage(message({ id: "a1", status: "done", content: "hi" }));
    expect(vi.getTimerCount()).toBe(0);
    expect(getState()).toMatchObject({ isStreaming: false, streamingMessageId: null });

    vi.advanceTimersByTime(STREAM_TIMEOUT_MS);
    expect(addToast).not.toHaveBeenCalled();
    expect(getState().messages[0].status).toBe("done");
  });

  it("re-arms the timer on stream activity for primary agent messages only", () => {
    const { manager, getState } = setup();
    manager.addMessage(message({ id: "a1", status: "thinking" }));
    manager.addMessage(message({ id: "t1", status: "streaming", threadId: "thread-1" }));

    vi.advanceTimersByTime(STREAM_TIMEOUT_MS - 1);
    manager.noteStreamActivity("t1");
    vi.advanceTimersByTime(1);
    expect(getState().isStreaming).toBe(false);

    const second = setup();
    second.manager.addMessage(message({ id: "a2", status: "thinking" }));
    vi.advanceTimersByTime(STREAM_TIMEOUT_MS - 1);
    second.manager.noteStreamActivity("a2");
    vi.advanceTimersByTime(STREAM_TIMEOUT_MS - 1);
    expect(second.getState().isStreaming).toBe(true);
    vi.advanceTimersByTime(1);
    expect(second.getState().isStreaming).toBe(false);
  });
});

describe("StreamManager fallback AbortController", () => {
  it("aborts the registered controller and forgets it", () => {
    const { manager } = setup();
    const controller = new AbortController();
    manager.setFallbackController(controller);

    manager.abortFallback();
    expect(controller.signal.aborted).toBe(true);

    const next = new AbortController();
    manager.abortFallback();
    expect(next.signal.aborted).toBe(false);
  });

  it("only clears the controller that is currently registered", () => {
    const { manager } = setup();
    const stale = new AbortController();
    const current = new AbortController();
    manager.setFallbackController(current);

    manager.clearFallbackController(stale);
    manager.abortFallback();
    expect(current.signal.aborted).toBe(true);

    const cleared = new AbortController();
    manager.setFallbackController(cleared);
    manager.clearFallbackController(cleared);
    manager.abortFallback();
    expect(cleared.signal.aborted).toBe(false);
  });

  it("cancelStream aborts the fallback, sends cancel, and marks the message partial", () => {
    const { manager, getState } = setup();
    const controller = new AbortController();
    manager.setFallbackController(controller);
    manager.addMessage(message({ id: "a1", status: "thinking" }));
    manager.appendStreamChunk("a1", "partial text");

    manager.cancelStream();
    expect(controller.signal.aborted).toBe(true);
    expect(getState().webSocketSend).toHaveBeenCalledWith({ type: "cancel", messageId: "a1" });
    expect(getState().messages[0]).toMatchObject({ status: "partial", content: "partial text" });
    expect(getState()).toMatchObject({ isStreaming: false, streamingMessageId: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancelStream without an active stream only resets streaming flags", () => {
    const { manager, getState } = setup({ isStreaming: true });
    manager.cancelStream();
    expect(getState().webSocketSend).not.toHaveBeenCalled();
    expect(getState()).toMatchObject({ isStreaming: false, streamingMessageId: null });
  });
});

describe("StreamManager message state", () => {
  it("appends new messages and replaces existing ones by id", () => {
    const { manager, getState } = setup();
    manager.addMessage(message({ id: "a1", content: "one" }));
    manager.addMessage(message({ id: "a2", content: "two" }));
    manager.addMessage(message({ id: "a1", content: "one!" }));
    expect(getState().messages.map((m) => [m.id, m.content])).toEqual([
      ["a1", "one!"],
      ["a2", "two"],
    ]);
  });

  it("replaces an optimistic user message with the confirmed one", () => {
    const optimistic = message({
      id: "tmp-1",
      fromType: "user",
      fromId: "user-1",
      content: "hello",
      status: "sending",
    });
    const { manager, getState } = setup({ messages: [optimistic] });

    manager.addMessage({ ...optimistic, id: "u1", status: "done" });
    expect(getState().messages).toHaveLength(1);
    expect(getState().messages[0]).toMatchObject({ id: "u1", status: "done" });

    manager.addMessage({ ...optimistic, id: "u2", conversationId: "conv-2", status: "done" });
    expect(getState().messages).toHaveLength(2);
  });

  it("enters streaming on agent streaming status without arming a timer", () => {
    const { manager, getState } = setup();
    manager.addMessage(message({ id: "a1", status: "streaming" }));
    expect(getState()).toMatchObject({ isStreaming: true, streamingMessageId: "a1" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores thread messages and terminal messages of non-streaming ids for streaming state", () => {
    const { manager, getState } = setup();
    manager.addMessage(message({ id: "t1", status: "thinking", threadId: "thread-1" }));
    expect(getState()).toMatchObject({ isStreaming: false, streamingMessageId: null });
    expect(vi.getTimerCount()).toBe(0);

    manager.addMessage(message({ id: "a1", status: "thinking" }));
    manager.addMessage(message({ id: "other", status: "done" }));
    expect(getState()).toMatchObject({ isStreaming: true, streamingMessageId: "a1" });
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(["done", "partial", "error"] as const)(
    "leaves streaming when the streaming message arrives as %s",
    (status) => {
      const { manager, getState } = setup();
      manager.addMessage(message({ id: "a1", status: "thinking" }));
      manager.addMessage(message({ id: "a1", status }));
      expect(getState()).toMatchObject({ isStreaming: false, streamingMessageId: null });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("appends chunks and marks primary messages as streaming", () => {
    const { manager, getState } = setup({
      messages: [message({ id: "a1", status: "thinking", content: "He" })],
    });
    manager.appendStreamChunk("a1", "llo");
    expect(getState().messages[0]).toMatchObject({ content: "Hello", status: "streaming" });
    expect(getState()).toMatchObject({ isStreaming: true, streamingMessageId: "a1" });
  });

  it("appends thread chunks without touching the primary streaming state", () => {
    const { manager, getState } = setup({
      messages: [message({ id: "t1", status: "thinking", threadId: "thread-1", content: "x" })],
    });
    manager.appendStreamChunk("t1", "y");
    expect(getState().messages[0].content).toBe("xy");
    expect(getState()).toMatchObject({ isStreaming: false, streamingMessageId: null });

    manager.appendStreamChunk("missing", "z");
    expect(getState().isStreaming).toBe(false);
  });

  it("setMessageStatus transitions primary stream state and clears the timer on terminal status", () => {
    const { manager, getState } = setup({ messages: [message({ id: "a1", status: "done" })] });
    manager.armStreamTimer("a1");

    manager.setMessageStatus("a1", "streaming");
    expect(getState()).toMatchObject({ isStreaming: true, streamingMessageId: "a1" });
    expect(vi.getTimerCount()).toBe(1);

    manager.setMessageStatus("a1", "done");
    expect(getState()).toMatchObject({ isStreaming: false, streamingMessageId: null });
    expect(getState().messages[0].status).toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("setMessageStatus on non-primary messages keeps streaming state", () => {
    const { manager, getState } = setup({
      messages: [
        message({ id: "a1", status: "streaming" }),
        message({ id: "t1", status: "streaming", threadId: "thread-1" }),
      ],
      isStreaming: true,
      streamingMessageId: "a1",
    });
    manager.armStreamTimer("a1");

    manager.setMessageStatus("t1", "done");
    expect(getState().messages[1].status).toBe("done");
    expect(getState()).toMatchObject({ isStreaming: true, streamingMessageId: "a1" });
    expect(vi.getTimerCount()).toBe(1);
  });
});
