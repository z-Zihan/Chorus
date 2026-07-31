import { useEffect, useRef } from "react";
import type { ClientEvent, Message, ServerEvent } from "@agentlink/shared";
import { useChatStore } from "@/store/chatStore";
import { useAgentStore } from "@/store/agentStore";
import { getWsUrl } from "@/services/env";

const RECONNECT_BASE = 1000;
const RECONNECT_MAX = 30000;
const HEARTBEAT_MS = 30000;
const PONG_TIMEOUT_MS = 10000;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(RECONNECT_BASE);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventId = useRef<string | null>(null);
  const pendingEvents = useRef<ClientEvent[]>([]);

  const addMessage = useChatStore((s) => s.addMessage);
  const appendStreamChunk = useChatStore((s) => s.appendStreamChunk);
  const noteStreamActivity = useChatStore((s) => s.noteStreamActivity);
  const setMessageStatus = useChatStore((s) => s.setMessageStatus);
  const setWebSocketSend = useChatStore((s) => s.setWebSocketSend);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const updateAgentStatus = useAgentStore((s) => s.updateAgentStatus);

  useEffect(() => {
    let mounted = true;

    const sendEvent = (event: ClientEvent): boolean => {
      const ws = wsRef.current;
      if (ws?.readyState !== WebSocket.OPEN) {
        if (event.type === "cancel") {
          pendingEvents.current.push(event);
          return true;
        }
        return false;
      }
      ws.send(JSON.stringify(event));
      return true;
    };
    setWebSocketSend(sendEvent);

    const stopHeartbeat = () => {
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      if (pongTimer.current) clearTimeout(pongTimer.current);
      heartbeatTimer.current = null;
      pongTimer.current = null;
    };

    const startHeartbeat = () => {
      stopHeartbeat();
      heartbeatTimer.current = setInterval(() => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
          pongTimer.current = setTimeout(() => ws.close(), PONG_TIMEOUT_MS);
        }
      }, HEARTBEAT_MS);
    };

    const handleEvent = (event: ServerEvent) => {
      if (event.eventId) lastEventId.current = event.eventId;

      switch (event.type) {
        case "message":
          if (event.message.conversationId === useChatStore.getState().currentConversationId) {
            addMessage(event.message);
          }
          break;

        case "stream": {
          const { messageId, chunk } = event;
          const chatState = useChatStore.getState();
          const targetMessage = chatState.messages.find((message) => message.id === messageId);
          if (
            !targetMessage ||
            targetMessage.conversationId !== chatState.currentConversationId ||
            chunk.threadId
          ) break;
          noteStreamActivity(messageId);
          if (chunk.type === "text") {
            appendStreamChunk(messageId, chunk.content);
          } else if (chunk.type === "thinking") {
            setMessageStatus(messageId, "thinking");
          } else if (chunk.type === "done") {
            setMessageStatus(messageId, "done");
          } else if (chunk.type === "error") {
            setMessageStatus(messageId, "error");
          }
          break;
        }

        case "a2a_call":
          if (!useChatStore.getState().messages.some((message) => message.id === `a2a-call-${event.eventId}`)) {
            addMessage({
              id: `a2a-call-${event.eventId}`,
              conversationId: useChatStore.getState().currentConversationId ?? "",
              fromType: "agent",
              fromId: event.from,
              toType: "agent",
              toId: event.to,
              content: event.message,
              timestamp: Date.now(),
              threadId: event.threadId,
              status: "done",
              metadata: { a2aType: "call" },
            });
          }
          break;

        case "a2a_response":
          {
            const chatState = useChatStore.getState();
            const calls = chatState.messages.filter((message) =>
              message.threadId === event.threadId && message.metadata?.a2aType === "call"
            );
            const call = [...calls].reverse().find(
              (message) => message.toId === event.chunk.sourceAgentId
            ) ?? calls.at(-1);
            const responseId = `${call?.id ?? `a2a-${event.threadId}`}-response`;
            const existing = chatState.messages.find((message) => message.id === responseId);
            const status: Message["status"] = event.chunk.type === "error"
              ? "error"
              : event.chunk.type === "done" || event.chunk.metadata?.status === "done"
                ? "done"
                : "streaming";

            if (!existing) {
              addMessage({
                id: responseId,
                conversationId: call?.conversationId ?? chatState.currentConversationId ?? "",
                fromType: "agent",
                fromId: event.chunk.sourceAgentId ?? call?.toId ?? "agent",
                toType: "agent",
                toId: call?.fromId,
                content: event.chunk.content,
                timestamp: Date.now(),
                threadId: event.threadId,
                parentId: call?.id,
                status,
                metadata: { a2aType: "response" },
              });
            } else {
              if (event.chunk.content) appendStreamChunk(responseId, event.chunk.content);
              if (status !== "streaming") setMessageStatus(responseId, status);
            }
          }
          break;

        case "agent_status":
          if (event.agentId && event.status) {
            updateAgentStatus(event.agentId, event.status);
          }
          break;

        case "pong":
          if (pongTimer.current) {
            clearTimeout(pongTimer.current);
            pongTimer.current = null;
          }
          break;

        case "error":
          console.error("Server error:", event.message);
          break;
      }
    };

    const connect = () => {
      if (!mounted) return;
      const wsUrl = getWsUrl();
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectDelay.current = RECONNECT_BASE;
        startHeartbeat();
        if (currentConversationId) {
          ws.send(JSON.stringify({
            type: "subscribe",
            conversationId: currentConversationId,
            lastEventId: lastEventId.current,
          }));
        }
        for (const event of pendingEvents.current.splice(0)) {
          ws.send(JSON.stringify(event));
        }
      };

      ws.onmessage = (e) => {
        try {
          handleEvent(JSON.parse(e.data));
        } catch (err) {
          console.error("WS parse error:", err);
        }
      };

      ws.onclose = () => {
        stopHeartbeat();
        if (!mounted) return;
        const delay = reconnectDelay.current;
        reconnectDelay.current = Math.min(delay * 2, RECONNECT_MAX);
        setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      mounted = false;
      stopHeartbeat();
      wsRef.current?.close();
      if (useChatStore.getState().webSocketSend === sendEvent) {
        setWebSocketSend(null);
      }
    };
  }, [
    addMessage,
    appendStreamChunk,
    noteStreamActivity,
    setMessageStatus,
    setWebSocketSend,
    currentConversationId,
    updateAgentStatus,
  ]);
}
