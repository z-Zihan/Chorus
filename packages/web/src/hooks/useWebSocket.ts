import { useEffect, useRef } from "react";
import { useChatStore } from "@/store/chatStore";
import { useAgentStore } from "@/store/agentStore";
import type { ServerEvent } from "@/services/api";

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

  const addMessage = useChatStore((s) => s.addMessage);
  const appendStreamChunk = useChatStore((s) => s.appendStreamChunk);
  const setMessageStatus = useChatStore((s) => s.setMessageStatus);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const updateAgentStatus = useAgentStore((s) => s.updateAgentStatus);

  useEffect(() => {
    let mounted = true;

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
          if (event.message?.conversationId === currentConversationId) {
            addMessage(event.message);
          }
          break;

        case "stream": {
          const { messageId, chunk } = event;
          if (!messageId || !chunk) break;
          if (chunk.type === "text") {
            appendStreamChunk(messageId, chunk.content);
          } else if (chunk.type === "thinking") {
            const msgs = useChatStore.getState().messages;
            if (!msgs.find((m) => m.id === messageId)) {
              addMessage({
                id: messageId,
                conversationId: currentConversationId ?? "",
                fromType: "agent",
                fromId: chunk.sourceAgentId ?? "agent",
                content: "",
                timestamp: Date.now(),
                status: "thinking",
                threadId: chunk.threadId,
              });
            }
            setMessageStatus(messageId, "thinking");
          } else if (chunk.type === "done") {
            setMessageStatus(messageId, "done");
          } else if (chunk.type === "error") {
            setMessageStatus(messageId, "error");
          }
          break;
        }

        case "a2a_call":
          if (event.threadId) {
            addMessage({
              id: crypto.randomUUID(),
              conversationId: currentConversationId ?? "",
              fromType: "agent",
              fromId: event.from ?? "",
              toType: "agent",
              toId: event.to,
              content: event.message ?? "",
              timestamp: Date.now(),
              threadId: event.threadId,
              status: "done",
            });
          }
          break;

        case "a2a_response":
          if (event.threadId && event.chunk?.content) {
            appendStreamChunk(event.threadId + "-response", event.chunk.content);
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
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${location.host}/ws`);
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
    };
  }, [
    addMessage,
    appendStreamChunk,
    setMessageStatus,
    currentConversationId,
    updateAgentStatus,
  ]);
}
