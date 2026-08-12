import type { ClientEvent, Message } from "@chorus/shared";
import i18n from "@/i18n";
import { useUIStore } from "@/store/uiStore";
import { logger } from "@/utils/logger";

export const STREAM_TIMEOUT_MS = 180_000;

type WebSocketSend = (event: ClientEvent) => boolean;

interface StreamState {
  messages: Message[];
  isStreaming: boolean;
  streamingMessageId: string | null;
  webSocketSend: WebSocketSend | null;
}

type UpdateStreamState<T extends StreamState> = (
  updater: (state: T) => Partial<StreamState>,
) => void;

export class StreamManager<T extends StreamState> {
  private streamTimer: ReturnType<typeof setTimeout> | null = null;
  private timeoutMessageId: string | null = null;
  private fallbackController: AbortController | null = null;

  constructor(
    private readonly getState: () => T,
    private readonly updateState: UpdateStreamState<T>,
  ) {}

  clearStreamTimer(): void {
    if (this.streamTimer) clearTimeout(this.streamTimer);
    this.streamTimer = null;
    this.timeoutMessageId = null;
  }

  armStreamTimer(messageId: string): void {
    this.clearStreamTimer();
    this.timeoutMessageId = messageId;
    this.streamTimer = setTimeout(() => {
      const state = this.getState();
      if (!state.isStreaming) {
        this.clearStreamTimer();
        return;
      }

      const targetId = state.streamingMessageId ?? this.timeoutMessageId;
      if (state.streamingMessageId) {
        state.webSocketSend?.({ type: "cancel", messageId: state.streamingMessageId });
      }
      this.abortFallback();

      this.updateState((current) => ({
        messages: targetId
          ? current.messages.map((message) =>
              message.id === targetId ? { ...message, status: "error" as const } : message,
            )
          : current.messages,
        isStreaming: false,
        streamingMessageId: null,
      }));
      useUIStore.getState().addToast(i18n.t("errors:agentTimeout"), "error");
      logger.error("Agent response timed out", { messageId: targetId });
      this.clearStreamTimer();
    }, STREAM_TIMEOUT_MS);
  }

  setFallbackController(controller: AbortController): void {
    this.fallbackController = controller;
  }

  clearFallbackController(controller: AbortController): void {
    if (this.fallbackController === controller) this.fallbackController = null;
  }

  abortFallback(): void {
    this.fallbackController?.abort();
    this.fallbackController = null;
  }

  addMessage(message: Message): void {
    this.updateState((state) => {
      const existingIndex = state.messages.findIndex((item) => item.id === message.id);
      const optimisticIndex =
        message.fromType === "user"
          ? state.messages.findIndex(
              (item) =>
                item.fromType === "user" &&
                item.status === "sending" &&
                item.conversationId === message.conversationId &&
                item.content === message.content,
            )
          : -1;
      const replaceIndex = existingIndex >= 0 ? existingIndex : optimisticIndex;
      const messages = [...state.messages];
      if (replaceIndex >= 0) messages[replaceIndex] = message;
      else messages.push(message);

      if (message.fromType !== "agent" || message.threadId) return { messages };
      if (message.status === "thinking" || message.status === "streaming") {
        // Re-arm the stream timer when thinking starts, so slow agents
        // (e.g. Codex ~70s) are not cancelled before the first chunk.
        if (message.status === "thinking") this.armStreamTimer(message.id);
        return { messages, isStreaming: true, streamingMessageId: message.id };
      }
      if (
        state.streamingMessageId === message.id &&
        (message.status === "done" || message.status === "partial" || message.status === "error")
      ) {
        this.clearStreamTimer();
        return { messages, isStreaming: false, streamingMessageId: null };
      }
      return { messages };
    });
  }

  appendStreamChunk(messageId: string, chunk: string): void {
    this.updateState((state) => {
      const target = state.messages.find((message) => message.id === messageId);
      return {
        messages: state.messages.map((message) =>
          message.id === messageId
            ? { ...message, content: message.content + chunk, status: "streaming" as const }
            : message,
        ),
        ...(target && !target.threadId ? { isStreaming: true, streamingMessageId: messageId } : {}),
      };
    });
  }

  noteStreamActivity(messageId: string): void {
    const target = this.getState().messages.find((message) => message.id === messageId);
    if (target?.fromType === "agent" && !target.threadId) this.armStreamTimer(messageId);
  }

  setMessageStatus(messageId: string, status: Message["status"]): void {
    this.updateState((state) => {
      const target = state.messages.find((message) => message.id === messageId);
      const isTerminal = status === "done" || status === "error" || status === "partial";
      const isPrimaryStream = Boolean(target?.fromType === "agent" && !target.threadId);
      if (isPrimaryStream && isTerminal) this.clearStreamTimer();
      return {
        messages: state.messages.map((message) =>
          message.id === messageId ? { ...message, status } : message,
        ),
        isStreaming: isPrimaryStream ? !isTerminal : state.isStreaming,
        streamingMessageId: isPrimaryStream
          ? isTerminal
            ? null
            : messageId
          : state.streamingMessageId,
      };
    });
  }

  cancelStream(): void {
    this.clearStreamTimer();
    this.abortFallback();
    const messageId = this.getState().streamingMessageId;
    if (messageId) {
      this.getState().webSocketSend?.({ type: "cancel", messageId });
      this.setMessageStatus(messageId, "partial");
    }
    this.updateState(() => ({ isStreaming: false, streamingMessageId: null }));
  }
}
