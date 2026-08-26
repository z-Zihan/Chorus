import { randomUUID } from "node:crypto";
import type { AgentStatusSnapshot, ServerEvent } from "@chorus/shared";
import type WebSocket from "ws";

type EventPayload<T> = T extends { eventId: string } ? Omit<T, "eventId"> : never;
export type ServerEventPayload = EventPayload<ServerEvent>;

export class EventHub {
  private readonly sockets = new Set<WebSocket>();
  private readonly subscriptions = new Map<WebSocket, Set<string>>();
  private readonly buffers = new Map<string, ServerEvent[]>();

  add(socket: WebSocket): void {
    this.sockets.add(socket);
    this.subscriptions.set(socket, new Set());
  }

  remove(socket: WebSocket): void {
    this.sockets.delete(socket);
    this.subscriptions.delete(socket);
  }

  subscribe(socket: WebSocket, conversationId: string, lastEventId?: string): void {
    const subscriptions = this.subscriptions.get(socket);
    subscriptions?.clear();
    subscriptions?.add(conversationId);
    if (!lastEventId) return;
    const events = this.buffers.get(conversationId) ?? [];
    const index = events.findIndex((event) => event.eventId === lastEventId);
    const missed = index >= 0 ? events.slice(index + 1) : events;
    for (const event of missed) this.send(socket, event);
  }

  publish(conversationId: string | undefined, payload: ServerEventPayload): ServerEvent {
    const event = { ...payload, eventId: randomUUID() } as ServerEvent;
    if (conversationId) {
      const buffer = this.buffers.get(conversationId) ?? [];
      buffer.push(event);
      if (buffer.length > 100) buffer.splice(0, buffer.length - 100);
      this.buffers.set(conversationId, buffer);
    }

    for (const socket of this.sockets) {
      if (!conversationId || this.subscriptions.get(socket)?.has(conversationId)) {
        this.send(socket, event);
      }
    }
    // Messages are also delivered per-conversation, so sessions viewing another
    // conversation need a broadcast signal to refresh their conversation list.
    if (conversationId && payload.type === "message") {
      const activity: ServerEvent = {
        type: "conversation_activity",
        eventId: randomUUID(),
        conversationId,
        updatedAt: Date.now(),
      };
      for (const socket of this.sockets) this.send(socket, activity);
    }
    return event;
  }

  /** Broadcast a list-level activity signal (no message content) to all clients. */
  publishConversationActivity(conversationId: string): void {
    const activity: ServerEvent = {
      type: "conversation_activity",
      eventId: randomUUID(),
      conversationId,
      updatedAt: Date.now(),
    };
    for (const socket of this.sockets) this.send(socket, activity);
  }

  sendDirect(socket: WebSocket, payload: ServerEventPayload): void {
    this.send(socket, { ...payload, eventId: randomUUID() } as ServerEvent);
  }

  broadcastStatus(status: AgentStatusSnapshot): void {
    this.publish(undefined, { type: "agent_status", ...status });
  }

  sendStatusBatch(socket: WebSocket, statuses: AgentStatusSnapshot[]): void {
    this.sendDirect(socket, { type: "agent_status_batch", statuses });
  }

  private send(socket: WebSocket, event: ServerEvent): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
  }
}
