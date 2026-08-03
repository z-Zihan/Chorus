import type { AppConfig, ClientEvent } from "@agentlink/shared";
import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import { z } from "zod";
import type { AgentRuntime } from "../agent/runtime";
import type { AgentRegistry } from "../agent/registry";
import type { EventHub } from "./events";
import { track } from "../analytics.js";
import { isValidAuthToken } from "../middleware/auth.js";

const eventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    conversationId: z.string().min(1),
    content: z.string().min(1).max(32_000),
    agentId: z.string().min(1).optional(),
    mentionedAgents: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal("typing"), conversationId: z.string(), isTyping: z.boolean() }),
  z.object({
    type: z.literal("subscribe"),
    conversationId: z.string().min(1),
    lastEventId: z.string().nullish(),
  }),
  z.object({ type: z.literal("cancel"), messageId: z.string().min(1) }),
  z.object({ type: z.literal("ping") }),
]);

export function registerWebSocket(
  app: FastifyInstance,
  events: EventHub,
  runtime: AgentRuntime,
  registry: AgentRegistry,
  auth: AppConfig["auth"] = { enabled: false, tokens: {} },
): void {
  const unsubscribe = registry.subscribeStatusChanges((status) => {
    events.broadcastStatus(status);
  });
  app.addHook("onClose", async () => unsubscribe());

  app.get("/ws", { websocket: true }, (socket, request) => {
    const ws = socket as WebSocket;
    if (auth.enabled) {
      const token = new URL(request.url, "http://localhost").searchParams.get("token");
      if (!token || !isValidAuthToken(token, auth.tokens)) {
        ws.close(1008, "Unauthorized");
        return;
      }
    }
    events.add(ws);
    events.sendStatusBatch(
      ws,
      registry.list().map((agent) => ({
        agentId: agent.id,
        status: agent.status,
        error: agent.error,
      })),
    );
    app.log.info("WebSocket client connected");
    track("ws_connect");

    ws.on("message", (data) => {
      let raw: unknown;
      try { raw = JSON.parse(data.toString()); } catch (error) {
        app.log.warn({ err: error }, "Invalid WebSocket JSON payload");
        events.sendDirect(ws, { type: "error", message: "Invalid JSON payload" });
        return;
      }
      const parsed = eventSchema.safeParse(raw);
      if (!parsed.success) {
        const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        const rawType = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).type : 'unknown';
        app.log.warn({ raw, issues, rawType }, "WebSocket event validation failed");
        events.sendDirect(ws, { type: "error", message: parsed.error.issues[0]?.message ?? "Invalid event" });
        return;
      }
      try {
        handleEvent(ws, parsed.data as ClientEvent, events, runtime, app);
      } catch (error) {
        app.log.error({ err: error }, "WebSocket event handler failed");
        events.sendDirect(ws, { type: "error", message: "Unable to process event" });
      }
    });
    ws.on("close", () => {
      app.log.info("WebSocket client disconnected");
      track("ws_disconnect");
      events.remove(ws);
    });
    ws.on("error", (error) => {
      app.log.error({ err: error }, "WebSocket connection error");
      track("error", { message: error.message, source: "websocket" });
      events.remove(ws);
    });
  });
}

function handleEvent(
  socket: WebSocket,
  event: ClientEvent,
  events: EventHub,
  runtime: AgentRuntime,
  app: FastifyInstance,
): void {
  if (event.type === "ping") {
    events.sendDirect(socket, { type: "pong" });
  } else if (event.type === "subscribe") {
    events.subscribe(socket, event.conversationId, event.lastEventId);
  } else if (event.type === "cancel") {
    runtime.cancel(event.messageId);
  } else if (event.type === "message") {
    void runtime.handleUserMessage(
      event.conversationId,
      event.content,
      event.mentionedAgents,
      event.agentId,
    )
      .catch((error: unknown) => {
        app.log.error({ err: error }, "Agent runtime failed while handling WebSocket message");
        events.sendDirect(socket, {
          type: "error",
          message: error instanceof Error ? error.message : "Unable to send message",
        });
      });
  }
}
