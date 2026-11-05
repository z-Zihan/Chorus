import type { Message, ServerEvent } from "@chorus/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type WebSocket from "ws";
import { EventHub } from "../events.js";

const OPEN = 1;
const CLOSED = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FakeSocket {
  socket: WebSocket;
  send: ReturnType<typeof vi.fn>;
  events: () => ServerEvent[];
}

function fakeSocket(readyState = OPEN): FakeSocket {
  const send = vi.fn();
  const socket = { readyState, OPEN, send } as unknown as WebSocket;
  return {
    socket,
    send,
    events: () => send.mock.calls.map(([raw]) => JSON.parse(raw as string) as ServerEvent),
  };
}

function message(conversationId: string, id = "m1"): Message {
  return {
    id,
    conversationId,
    fromType: "user",
    fromId: "user-1",
    content: "hello",
    timestamp: 1,
    status: "done",
  };
}

function stream(index: number) {
  return {
    type: "stream" as const,
    messageId: `m${index}`,
    chunk: { type: "text", content: String(index) } as never,
  };
}

describe("EventHub", () => {
  let hub: EventHub;

  beforeEach(() => {
    hub = new EventHub();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("broadcasts events without a conversation to every registered socket", () => {
    const a = fakeSocket();
    const b = fakeSocket();
    hub.add(a.socket);
    hub.add(b.socket);

    hub.publish(undefined, { type: "pong" });

    expect(a.events().map((event) => event.type)).toEqual(["pong"]);
    expect(b.events().map((event) => event.type)).toEqual(["pong"]);
  });

  it("does not deliver to sockets that were never added", () => {
    const stranger = fakeSocket();

    hub.publish(undefined, { type: "pong" });

    expect(stranger.send).not.toHaveBeenCalled();
  });

  it("delivers conversation events only to subscribed sockets", () => {
    const subscribed = fakeSocket();
    const other = fakeSocket();
    const unsubscribed = fakeSocket();
    hub.add(subscribed.socket);
    hub.add(other.socket);
    hub.add(unsubscribed.socket);
    hub.subscribe(subscribed.socket, "c1");
    hub.subscribe(other.socket, "c2");

    hub.publish("c1", stream(1));

    expect(subscribed.events()).toHaveLength(1);
    expect(subscribed.events()[0]).toMatchObject({ type: "stream", messageId: "m1" });
    expect(other.send).not.toHaveBeenCalled();
    expect(unsubscribed.send).not.toHaveBeenCalled();
  });

  it("replaces the previous subscription when re-subscribing", () => {
    const client = fakeSocket();
    hub.add(client.socket);
    hub.subscribe(client.socket, "c1");
    hub.subscribe(client.socket, "c2");

    hub.publish("c1", stream(1));
    hub.publish("c2", stream(2));

    expect(client.events().map((event) => event.type === "stream" && event.messageId)).toEqual([
      "m2",
    ]);
  });

  it("assigns a unique UUID eventId that matches the delivered payload", () => {
    const client = fakeSocket();
    hub.add(client.socket);

    const first = hub.publish(undefined, { type: "pong" });
    const second = hub.publish(undefined, { type: "pong" });

    expect(first.eventId).toMatch(UUID);
    expect(second.eventId).toMatch(UUID);
    expect(first.eventId).not.toBe(second.eventId);
    expect(client.events().map((event) => event.eventId)).toEqual([first.eventId, second.eventId]);
    expect(first).toMatchObject({ type: "pong" });
  });

  it("does not subscribe or replay when subscribing a socket that was never added", () => {
    const stranger = fakeSocket();
    const first = hub.publish("c1", stream(1));
    hub.publish("c1", stream(2));

    expect(() => hub.subscribe(stranger.socket, "c1", first.eventId)).not.toThrow();
    // Replay still writes directly to the socket even without registration.
    expect(stranger.events()).toHaveLength(1);
    hub.publish("c1", stream(3));
    expect(stranger.events()).toHaveLength(1);
  });

  describe("replay buffer", () => {
    it("replays only events after lastEventId", () => {
      const ids = [1, 2, 3, 4].map((index) => hub.publish("c1", stream(index)).eventId);
      const client = fakeSocket();
      hub.add(client.socket);

      hub.subscribe(client.socket, "c1", ids[1]);

      expect(client.events().map((event) => event.eventId)).toEqual([ids[2], ids[3]]);
    });

    it("replays nothing when lastEventId is the latest event", () => {
      const ids = [1, 2].map((index) => hub.publish("c1", stream(index)).eventId);
      const client = fakeSocket();
      hub.add(client.socket);

      hub.subscribe(client.socket, "c1", ids[1]);

      expect(client.send).not.toHaveBeenCalled();
    });

    it("replays the whole buffer when lastEventId is unknown", () => {
      const ids = [1, 2, 3].map((index) => hub.publish("c1", stream(index)).eventId);
      const client = fakeSocket();
      hub.add(client.socket);

      hub.subscribe(client.socket, "c1", "not-a-known-id");

      expect(client.events().map((event) => event.eventId)).toEqual(ids);
    });

    it("does not replay without a lastEventId", () => {
      hub.publish("c1", stream(1));
      const client = fakeSocket();
      hub.add(client.socket);

      hub.subscribe(client.socket, "c1");

      expect(client.send).not.toHaveBeenCalled();
    });

    it("replays nothing for a conversation without a buffer", () => {
      hub.publish("c1", stream(1));
      const client = fakeSocket();
      hub.add(client.socket);

      hub.subscribe(client.socket, "c2", "anything");

      expect(client.send).not.toHaveBeenCalled();
    });

    it("keeps buffers separate per conversation", () => {
      const c1 = hub.publish("c1", stream(1));
      const c2 = hub.publish("c2", stream(2));
      const client = fakeSocket();
      hub.add(client.socket);

      hub.subscribe(client.socket, "c2", "unknown");

      expect(client.events().map((event) => event.eventId)).toEqual([c2.eventId]);
      expect(client.events().map((event) => event.eventId)).not.toContain(c1.eventId);
    });

    it("does not buffer broadcast events without a conversation", () => {
      hub.publish(undefined, { type: "pong" });
      const client = fakeSocket();
      hub.add(client.socket);

      hub.subscribe(client.socket, "undefined", "unknown");

      expect(client.send).not.toHaveBeenCalled();
    });

    it("caps the buffer at the most recent 100 events", () => {
      const ids = Array.from(
        { length: 105 },
        (_, index) => hub.publish("c1", stream(index)).eventId,
      );
      const retained = ids.slice(5);

      const evicted = fakeSocket();
      hub.add(evicted.socket);
      // Event #5 (index 4) was evicted, so the whole retained window replays.
      hub.subscribe(evicted.socket, "c1", ids[4]);
      expect(evicted.events().map((event) => event.eventId)).toEqual(retained);

      const inWindow = fakeSocket();
      hub.add(inWindow.socket);
      // Event #6 (index 5) is the oldest retained event.
      hub.subscribe(inWindow.socket, "c1", ids[5]);
      expect(inWindow.events().map((event) => event.eventId)).toEqual(ids.slice(6));
      expect(inWindow.events()).toHaveLength(99);
    });
  });

  describe("conversation activity", () => {
    it("broadcasts conversation_activity to all sockets when a message is published", () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_700_000_000_000);
      const subscribed = fakeSocket();
      const elsewhere = fakeSocket();
      const idle = fakeSocket();
      hub.add(subscribed.socket);
      hub.add(elsewhere.socket);
      hub.add(idle.socket);
      hub.subscribe(subscribed.socket, "c1");
      hub.subscribe(elsewhere.socket, "c2");

      const published = hub.publish("c1", { type: "message", message: message("c1") });

      expect(subscribed.events().map((event) => event.type)).toEqual([
        "message",
        "conversation_activity",
      ]);
      for (const client of [elsewhere, idle]) {
        expect(client.events()).toHaveLength(1);
        expect(client.events()[0]).toEqual({
          type: "conversation_activity",
          eventId: expect.stringMatching(UUID),
          conversationId: "c1",
          updatedAt: 1_700_000_000_000,
        });
      }
      const activityId = idle.events()[0]?.eventId;
      expect(activityId).not.toBe(published.eventId);
    });

    it("does not buffer the conversation_activity signal for replay", () => {
      const published = hub.publish("c1", { type: "message", message: message("c1") });
      const client = fakeSocket();
      hub.add(client.socket);

      hub.subscribe(client.socket, "c1", "unknown");

      expect(client.events().map((event) => event.eventId)).toEqual([published.eventId]);
    });

    it("does not emit conversation_activity for non-message conversation events", () => {
      const other = fakeSocket();
      hub.add(other.socket);

      hub.publish("c1", stream(1));

      expect(other.send).not.toHaveBeenCalled();
    });

    it("does not emit conversation_activity for broadcast message events", () => {
      const client = fakeSocket();
      hub.add(client.socket);

      hub.publish(undefined, { type: "message", message: message("c1") });

      expect(client.events().map((event) => event.type)).toEqual(["message"]);
    });

    it("publishConversationActivity broadcasts to every socket", () => {
      vi.useFakeTimers();
      vi.setSystemTime(42_000);
      const a = fakeSocket();
      const b = fakeSocket();
      hub.add(a.socket);
      hub.add(b.socket);
      hub.subscribe(a.socket, "c9");

      hub.publishConversationActivity("c1");

      for (const client of [a, b]) {
        expect(client.events()).toEqual([
          {
            type: "conversation_activity",
            eventId: expect.stringMatching(UUID),
            conversationId: "c1",
            updatedAt: 42_000,
          },
        ]);
      }
      expect(a.events()[0]?.eventId).toBe(b.events()[0]?.eventId);
    });

    it("publishConversationActivity is not buffered for replay", () => {
      hub.publishConversationActivity("c1");
      const client = fakeSocket();
      hub.add(client.socket);

      hub.subscribe(client.socket, "c1", "unknown");

      expect(client.send).not.toHaveBeenCalled();
    });
  });

  describe("direct delivery", () => {
    it("sendDirect delivers to the target socket only with a fresh eventId", () => {
      const target = fakeSocket();
      const bystander = fakeSocket();
      hub.add(target.socket);
      hub.add(bystander.socket);

      hub.sendDirect(target.socket, { type: "error", message: "boom" });
      hub.sendDirect(target.socket, { type: "error", message: "boom" });

      const [first, second] = target.events();
      expect(first).toEqual({
        type: "error",
        message: "boom",
        eventId: expect.stringMatching(UUID),
      });
      expect(second?.eventId).toMatch(UUID);
      expect(second?.eventId).not.toBe(first?.eventId);
      expect(bystander.send).not.toHaveBeenCalled();
    });

    it("sendDirect does not buffer the event for replay", () => {
      const target = fakeSocket();
      hub.add(target.socket);
      hub.sendDirect(target.socket, {
        type: "typing",
        agentId: "a1",
        conversationId: "c1",
        isTyping: true,
      });
      const late = fakeSocket();
      hub.add(late.socket);

      hub.subscribe(late.socket, "c1", "unknown");

      expect(late.send).not.toHaveBeenCalled();
    });

    it("sendStatusBatch delivers agent_status_batch to the target socket only", () => {
      const target = fakeSocket();
      const bystander = fakeSocket();
      hub.add(target.socket);
      hub.add(bystander.socket);
      const statuses = [
        { agentId: "a1", status: "online" as const },
        { agentId: "a2", status: "error" as const, error: "crashed" },
      ];

      hub.sendStatusBatch(target.socket, statuses);

      expect(target.events()).toEqual([
        { type: "agent_status_batch", statuses, eventId: expect.stringMatching(UUID) },
      ]);
      expect(bystander.send).not.toHaveBeenCalled();
    });

    it("broadcastStatus publishes agent_status to every socket regardless of subscription", () => {
      const a = fakeSocket();
      const b = fakeSocket();
      hub.add(a.socket);
      hub.add(b.socket);
      hub.subscribe(a.socket, "c1");

      hub.broadcastStatus({ agentId: "a1", status: "busy" });

      for (const client of [a, b]) {
        expect(client.events()).toEqual([
          {
            type: "agent_status",
            agentId: "a1",
            status: "busy",
            eventId: expect.stringMatching(UUID),
          },
        ]);
      }
      expect(a.events()[0]?.eventId).toBe(b.events()[0]?.eventId);
    });
  });

  describe("socket state", () => {
    it("skips sockets that are not open without throwing", () => {
      const open = fakeSocket();
      const closed = fakeSocket(CLOSED);
      hub.add(open.socket);
      hub.add(closed.socket);
      hub.subscribe(open.socket, "c1");
      hub.subscribe(closed.socket, "c1");

      expect(() => {
        hub.publish(undefined, { type: "pong" });
        hub.publish("c1", { type: "message", message: message("c1") });
        hub.publishConversationActivity("c1");
        hub.broadcastStatus({ agentId: "a1", status: "online" });
        hub.sendDirect(closed.socket, { type: "pong" });
        hub.sendStatusBatch(closed.socket, []);
      }).not.toThrow();

      expect(closed.send).not.toHaveBeenCalled();
      expect(open.events().map((event) => event.type)).toEqual([
        "pong",
        "message",
        "conversation_activity",
        "conversation_activity",
        "agent_status",
      ]);
    });

    it("skips replay to a socket that is not open", () => {
      hub.publish("c1", stream(1));
      const closed = fakeSocket(CLOSED);
      hub.add(closed.socket);

      expect(() => hub.subscribe(closed.socket, "c1", "unknown")).not.toThrow();
      expect(closed.send).not.toHaveBeenCalled();
    });

    it("resumes delivery once a socket transitions to open", () => {
      const client = fakeSocket(0);
      hub.add(client.socket);

      hub.publish(undefined, { type: "pong" });
      (client.socket as { readyState: number }).readyState = OPEN;
      hub.publish(undefined, { type: "pong" });

      expect(client.events()).toHaveLength(1);
    });

    it("remove() stops all broadcast and conversation delivery to the socket", () => {
      const removed = fakeSocket();
      const kept = fakeSocket();
      hub.add(removed.socket);
      hub.add(kept.socket);
      hub.subscribe(removed.socket, "c1");
      hub.subscribe(kept.socket, "c1");

      hub.remove(removed.socket);
      hub.publish(undefined, { type: "pong" });
      hub.publish("c1", { type: "message", message: message("c1") });
      hub.publishConversationActivity("c1");
      hub.broadcastStatus({ agentId: "a1", status: "offline" });

      expect(removed.send).not.toHaveBeenCalled();
      expect(kept.events()).toHaveLength(5);
    });

    it("remove() of an unknown socket is a no-op", () => {
      const client = fakeSocket();
      hub.add(client.socket);

      expect(() => hub.remove(fakeSocket().socket)).not.toThrow();
      hub.publish(undefined, { type: "pong" });
      expect(client.events()).toHaveLength(1);
    });

    it("re-adding a removed socket starts with no subscriptions", () => {
      const client = fakeSocket();
      hub.add(client.socket);
      hub.subscribe(client.socket, "c1");
      hub.remove(client.socket);
      hub.add(client.socket);

      hub.publish("c1", stream(1));
      hub.publish(undefined, { type: "pong" });

      expect(client.events().map((event) => event.type)).toEqual(["pong"]);
    });
  });
});
