import type { ClientEvent } from "@agentlink/shared";
import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import { z } from "zod";
import type { AgentRuntime } from "../agent/runtime";
import type { EventHub } from "./events";

const eventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    conversationId: z.string().min(1),
    content: z.string().min(1).max(32_000),
    mentionedAgents: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal("typing"), conversationId: z.string(), isTyping: z.boolean() }),
  z.object({
    type: z.literal("subscribe"),
    conversationId: z.string().min(1),
    lastEventId: z.string().optional(),
  }),
  z.object({ type: z.literal("cancel"), messageId: z.string().min(1) }),
  z.object({ type: z.literal("ping") }),
]);

export function registerWebSocket(
  app: FastifyInstance,
  events: EventHub,
  runtime: AgentRuntime,
): void {
  app.get("/ws", { websocket: true }, (socket) => {
    const ws = socket as WebSocket;
    events.add(ws);

    ws.on("message", (data) => {
      let raw: unknown;
      try { raw = JSON.parse(data.toString()); } catch {
        events.sendDirect(ws, { type: "error", message: "Invalid JSON payload" });
        return;
      }
      const parsed = eventSchema.safeParse(raw);
      if (!parsed.success) {
        events.sendDirect(ws, { type: "error", message: parsed.error.issues[0]?.message ?? "Invalid event" });
        return;
      }
      handleEvent(ws, parsed.data as ClientEvent, events, runtime);
    });
    ws.on("close", () => events.remove(ws));
    ws.on("error", () => events.remove(ws));
  });
}

function handleEvent(
  socket: WebSocket,
  event: ClientEvent,
  events: EventHub,
  runtime: AgentRuntime,
): void {
  if (event.type === "ping") {
    events.sendDirect(socket, { type: "pong" });
  } else if (event.type === "subscribe") {
    events.subscribe(socket, event.conversationId, event.lastEventId);
  } else if (event.type === "cancel") {
    runtime.cancel(event.messageId);
  } else if (event.type === "message") {
    void runtime.handleUserMessage(event.conversationId, event.content, event.mentionedAgents)
      .catch((error: unknown) => events.sendDirect(socket, {
        type: "error",
        message: error instanceof Error ? error.message : "Unable to send message",
      }));
  }
}
