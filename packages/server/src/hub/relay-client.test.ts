import type { HubEnvelope, RelayServerMessage, RoomInfo, RoomMember } from "@chorus/shared";
import { HEARTBEAT_INTERVAL_MS, PONG_TIMEOUT_MS } from "@chorus/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { RelayClient } from "./relay-client.js";

function configure(client: RelayClient, fields: Record<string, unknown>): void {
  Object.assign(client as unknown as Record<string, unknown>, fields);
}

function bindHandleMessage(client: RelayClient): (message: RelayServerMessage) => void {
  return (
    client as unknown as {
      handleMessage(message: RelayServerMessage): void;
    }
  ).handleMessage.bind(client);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function member(hubId: string, online: boolean): RoomMember {
  return { hubId, publicKey: `${hubId}-key`, displayName: hubId.toUpperCase(), online };
}

function envelope(id: string): HubEnvelope {
  return {
    id,
    from: "hub-b",
    to: "hub-a",
    type: "direct",
    timestamp: 1_000,
    nonce: "nonce",
    ciphertext: "ciphertext",
    signature: "signature",
  };
}

describe("RelayClient authentication renewal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes once and retries an HTTP request rejected with 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ invitations: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const tokenProvider = vi.fn().mockResolvedValue("renewed-token");
    const client = new RelayClient();
    Object.assign(client as unknown as Record<string, unknown>, {
      hubId: "hub-a",
      token: "expired-token",
      tokenProvider,
    });

    await expect(client.listRoomInvitationsRequest("ws://relay.example/ws")).resolves.toEqual([]);
    expect(tokenProvider).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers as HeadersInit);
    const secondHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers as HeadersInit);
    expect(firstHeaders.get("authorization")).toBe("Bearer expired-token");
    expect(secondHeaders.get("authorization")).toBe("Bearer renewed-token");
    expect(firstHeaders.has("content-type")).toBe(false);
  });

  it("deduplicates concurrent token refreshes", async () => {
    let resolveToken: ((token: string) => void) | undefined;
    const tokenProvider = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveToken = resolve;
        }),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ invitations: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new RelayClient();
    Object.assign(client as unknown as Record<string, unknown>, {
      hubId: "hub-a",
      token: "expired-token",
      tokenProvider,
    });

    const requests = [
      client.listRoomInvitationsRequest("ws://relay.example/ws"),
      client.listRoomInvitationsRequest("ws://relay.example/ws"),
    ];
    await vi.waitFor(() => expect(tokenProvider).toHaveBeenCalledTimes(1));
    resolveToken?.("renewed-token");
    await expect(Promise.all(requests)).resolves.toEqual([[], []]);
    expect(tokenProvider).toHaveBeenCalledTimes(1);
  });
});

describe("RelayClient transport status", () => {
  it("forwards transport updates without treating them as execution state", () => {
    const client = new RelayClient();
    const listener = vi.fn();
    client.onTransportStatus(listener);

    const handleMessage = (
      client as unknown as {
        handleMessage(message: RelayServerMessage): void;
      }
    ).handleMessage.bind(client);
    handleMessage({
      type: "transport_status",
      messageId: "envelope-1",
      status: "delivered",
      timestamp: 1_000,
    });

    expect(listener).toHaveBeenCalledWith({
      messageId: "envelope-1",
      status: "delivered",
      timestamp: 1_000,
    });
  });
});

describe("RelayClient room requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("upgrades ws to http and replaces path, query and hash", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ invitations: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new RelayClient();
    configure(client, { hubId: "hub-a", token: "token-a" });

    await client.listRoomInvitationsRequest("ws://relay.example:8080/ws?hub=1#frag");

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.protocol).toBe("http:");
    expect(url.host).toBe("relay.example:8080");
    expect(url.pathname).toBe("/api/room-invitations");
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
  });

  it("upgrades wss to https and sends a JSON content type with a body", async () => {
    const room: RoomInfo = {
      id: "room-1",
      name: "Room",
      members: [],
      createdAt: 1,
      createdBy: "hub-a",
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(room));
    vi.stubGlobal("fetch", fetchMock);
    const client = new RelayClient();
    configure(client, { hubId: "hub-a", token: "token-a" });

    await expect(client.createRoomRequest("wss://relay.example/ws", "Room")).resolves.toEqual(room);

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.protocol).toBe("https:");
    expect(url.pathname).toBe("/api/rooms");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ name: "Room" }));
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer token-a");
  });

  it("rejects without calling fetch when the Hub identity is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new RelayClient();
    configure(client, { token: "token-a" });

    await expect(client.listRoomInvitationsRequest("ws://relay.example/ws")).rejects.toThrow(
      "Hub identity is not configured",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects without calling fetch when the token is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new RelayClient();
    configure(client, { hubId: "hub-a" });

    await expect(client.listRoomInvitationsRequest("ws://relay.example/ws")).rejects.toThrow(
      "Relay authentication token is not configured",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a 401 without retrying when no token provider is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("token expired", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new RelayClient();
    configure(client, { hubId: "hub-a", token: "token-a" });

    await expect(client.listRoomInvitationsRequest("ws://relay.example/ws")).rejects.toThrow(
      "token expired",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws the response detail for a failed request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Room not found", { status: 404 })),
    );
    const client = new RelayClient();
    configure(client, { hubId: "hub-a", token: "token-a" });

    await expect(client.getRoomRequest("ws://relay.example/ws", "room-1")).rejects.toThrow(
      "Room not found",
    );
  });

  it("falls back to the HTTP status when a failed request has no body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    const client = new RelayClient();
    configure(client, { hubId: "hub-a", token: "token-a" });

    await expect(client.getRoomRequest("ws://relay.example/ws", "room-1")).rejects.toThrow(
      "Relay room request failed with HTTP 503",
    );
  });

  it("caches room members and their public keys from a fetched room", async () => {
    const room: RoomInfo = {
      id: "room/1",
      name: "Room",
      members: [member("hub-b", true), member("hub-c", false)],
      createdAt: 1,
      createdBy: "hub-a",
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(room));
    vi.stubGlobal("fetch", fetchMock);
    const client = new RelayClient();
    configure(client, { hubId: "hub-a", token: "token-a" });

    await client.getRoomRequest("ws://relay.example/ws", "room/1");

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/rooms/room%2F1");
    expect(client.getOnlineRoomMembers("room/1")).toEqual([member("hub-b", true)]);
    expect(client.getPeerPublicKey("hub-b")).toBe("hub-b-key");
    expect(client.getPeerPublicKey("hub-c")).toBe("hub-c-key");
  });
});

describe("RelayClient message dispatch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers relayed envelopes to every message listener", () => {
    const client = new RelayClient();
    const first = vi.fn();
    const second = vi.fn();
    client.onMessage(first);
    client.onMessage(second);

    bindHandleMessage(client)({ type: "message", envelope: envelope("env-1") });

    expect(first).toHaveBeenCalledWith(envelope("env-1"));
    expect(second).toHaveBeenCalledWith(envelope("env-1"));
  });

  it("delivers offline envelopes as a batch", () => {
    const client = new RelayClient();
    const listener = vi.fn();
    client.onOfflineMessages(listener);

    bindHandleMessage(client)({
      type: "offline_messages",
      envelopes: [envelope("env-1"), envelope("env-2")],
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith([envelope("env-1"), envelope("env-2")]);
  });

  it("caches presence keys, updates cached room members and notifies listeners", () => {
    const client = new RelayClient();
    const listener = vi.fn();
    client.onPresence(listener);
    const handleMessage = bindHandleMessage(client);
    handleMessage({
      type: "room:members",
      roomId: "room-1",
      members: [member("hub-b", false), member("hub-c", true)],
    });
    handleMessage({
      type: "room:members",
      roomId: "room-2",
      members: [member("hub-c", true)],
    });

    handleMessage({
      type: "presence",
      hubId: "hub-b",
      status: "online",
      publicKey: "hub-b-new-key",
      displayName: "Bee",
    });
    handleMessage({ type: "presence", hubId: "hub-c", status: "offline" });

    expect(client.getPeerPublicKey("hub-b")).toBe("hub-b-new-key");
    expect(client.getPeerPublicKey("hub-c")).toBe("hub-c");
    expect(client.getOnlineRoomMembers("room-1")).toEqual([member("hub-b", true)]);
    expect(client.getOnlineRoomMembers("room-2")).toEqual([]);
    expect(listener).toHaveBeenNthCalledWith(1, "hub-b", "online", "hub-b-new-key", "Bee");
    expect(listener).toHaveBeenNthCalledWith(2, "hub-c", "offline", undefined, undefined);
  });

  it("forwards room events", () => {
    const client = new RelayClient();
    const listener = vi.fn();
    client.onRoomEvent(listener);

    bindHandleMessage(client)({
      type: "room:event",
      roomId: "room-1",
      event: "invite",
      hubId: "hub-b",
    });

    expect(listener).toHaveBeenCalledWith("room-1", "invite", "hub-b");
  });

  it("caches pushed room members and notifies listeners", () => {
    const client = new RelayClient();
    const listener = vi.fn();
    client.onRoomMembers(listener);
    const members = [member("hub-b", true), member("hub-c", false)];

    bindHandleMessage(client)({ type: "room:members", roomId: "room-1", members });

    expect(listener).toHaveBeenCalledWith("room-1", members);
    expect(client.getOnlineRoomMembers("room-1")).toEqual([member("hub-b", true)]);
    expect(client.getPeerPublicKey("hub-c")).toBe("hub-c-key");
  });

  it("resolves pending Room CAS requests in order and clears their timeouts", async () => {
    vi.useFakeTimers();
    const client = new RelayClient();
    const send = vi.fn();
    configure(client, {
      connectionState: "connected",
      socket: { readyState: WebSocket.OPEN, send },
    });
    const pending = (client as unknown as { pendingRoomCas: Map<string, unknown[]> })
      .pendingRoomCas;
    const handleMessage = bindHandleMessage(client);

    const first = client.roomCas(
      "room-1",
      { revision: 1, keyEpoch: 1 },
      { revision: 2, keyEpoch: 1 },
    );
    const second = client.roomCas(
      "room-1",
      { revision: 2, keyEpoch: 1 },
      { revision: 3, keyEpoch: 2 },
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(send.mock.calls[0]?.[0]))).toEqual({
      type: "room_cas",
      roomId: "room-1",
      expectedRevision: 1,
      expectedKeyEpoch: 1,
      newRevision: 2,
      newKeyEpoch: 1,
    });

    handleMessage({
      type: "room_cas_result",
      roomId: "room-1",
      accepted: true,
      revision: 2,
      keyEpoch: 1,
    });
    await expect(first).resolves.toEqual({ accepted: true, revision: 2, keyEpoch: 1 });
    expect(pending.get("room-1")).toHaveLength(1);

    handleMessage({
      type: "room_cas_result",
      roomId: "room-1",
      accepted: false,
      revision: 5,
      keyEpoch: 3,
    });
    await expect(second).resolves.toEqual({ accepted: false, revision: 5, keyEpoch: 3 });
    expect(pending.has("room-1")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores Room CAS results without a pending request", () => {
    const client = new RelayClient();

    expect(() =>
      bindHandleMessage(client)({
        type: "room_cas_result",
        roomId: "room-unknown",
        accepted: true,
        revision: 1,
        keyEpoch: 1,
      }),
    ).not.toThrow();
  });

  it("clears the pong timeout when a pong message arrives", () => {
    vi.useFakeTimers();
    const client = new RelayClient();
    const terminate = vi.fn();
    configure(client, {
      socket: { terminate },
      pongTimer: setTimeout(terminate, 1_000),
    });

    bindHandleMessage(client)({ type: "pong" });
    vi.advanceTimersByTime(5_000);

    expect(terminate).not.toHaveBeenCalled();
    expect((client as unknown as { pongTimer?: unknown }).pongTimer).toBeUndefined();
  });

  it("ignores unknown or untyped messages without notifying listeners", () => {
    const client = new RelayClient();
    const [message, offline, presence, roomEvent, roomMembers, transport, state] = [
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    ] as const;
    const listeners = [message, offline, presence, roomEvent, roomMembers, transport, state];
    client.onMessage(message);
    client.onOfflineMessages(offline);
    client.onPresence(presence);
    client.onRoomEvent(roomEvent);
    client.onRoomMembers(roomMembers);
    client.onTransportStatus(transport);
    client.onStateChange(state);
    const handleMessage = bindHandleMessage(client);

    expect(() => {
      handleMessage({ type: "contact_block_ack", blockedHubId: "hub-b", success: true });
      handleMessage({ type: "not-a-relay-type" } as unknown as RelayServerMessage);
      handleMessage({} as unknown as RelayServerMessage);
    }).not.toThrow();
    for (const listener of listeners) expect(listener).not.toHaveBeenCalled();
  });
});

describe("RelayClient relay latency", () => {
  type LatencyFields = {
    pingSentAt: number | null;
    lastRelayLatency: number | null;
    pongTimer?: unknown;
  };
  const fields = (client: RelayClient): LatencyFields => client as unknown as LatencyFields;
  const startHeartbeat = (client: RelayClient): void =>
    (client as unknown as { startHeartbeat(): void }).startHeartbeat();

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records latency from the outstanding ping and consumes it on pong", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const client = new RelayClient();
    configure(client, { pingSentAt: Date.now() });

    vi.advanceTimersByTime(42);
    bindHandleMessage(client)({ type: "pong" });

    expect(client.relayLatencyMs).toBe(42);
    expect(fields(client).pingSentAt).toBeNull();
  });

  it("ignores unsolicited pongs when no ping is outstanding", () => {
    vi.useFakeTimers();
    const client = new RelayClient();
    const handleMessage = bindHandleMessage(client);

    handleMessage({ type: "pong" });
    expect(client.relayLatencyMs).toBeNull();

    configure(client, { pingSentAt: Date.now() });
    vi.advanceTimersByTime(15);
    handleMessage({ type: "pong" });
    vi.advanceTimersByTime(1_000);
    handleMessage({ type: "pong" });

    expect(client.relayLatencyMs).toBe(15);
    expect(fields(client).pingSentAt).toBeNull();
  });

  it("sends a ping and records pingSentAt on heartbeat ticks only while the socket is open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(50_000);
    const client = new RelayClient();
    const send = vi.fn();
    const socket: {
      readyState: number;
      send: typeof send;
      terminate: () => void;
      close: () => void;
    } = {
      readyState: WebSocket.CONNECTING,
      send,
      terminate: vi.fn(),
      close: vi.fn(),
    };
    configure(client, { socket });
    startHeartbeat(client);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(send).not.toHaveBeenCalled();
    expect(fields(client).pingSentAt).toBeNull();
    expect(fields(client).pongTimer).toBeUndefined();

    socket.readyState = WebSocket.OPEN;
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    expect(send).toHaveBeenCalledOnce();
    expect(JSON.parse(send.mock.calls[0]?.[0] as string)).toEqual({ type: "ping" });
    expect(fields(client).pingSentAt).toBe(50_000 + 2 * HEARTBEAT_INTERVAL_MS);
    expect(fields(client).pongTimer).toBeDefined();

    client.disconnect();
  });

  it("resets the outstanding ping and last latency when the heartbeat stops", () => {
    vi.useFakeTimers();
    const client = new RelayClient();
    configure(client, { pingSentAt: Date.now(), lastRelayLatency: 37 });
    expect(client.relayLatencyMs).toBe(37);

    client.disconnect();

    expect(client.relayLatencyMs).toBeNull();
    expect(fields(client).pingSentAt).toBeNull();
    expect(fields(client).lastRelayLatency).toBeNull();
  });
});

describe("RelayClient message parsing", () => {
  const parse = (client: RelayClient, raw: string): RelayServerMessage | null =>
    (
      client as unknown as {
        parseMessage(data: Buffer): RelayServerMessage | null;
      }
    ).parseMessage.call(client, Buffer.from(raw));

  it("returns null for invalid JSON", () => {
    expect(parse(new RelayClient(), "{not json")).toBeNull();
  });

  it("returns null for JSON values without a type", () => {
    const client = new RelayClient();
    expect(parse(client, JSON.stringify({ roomId: "room-1" }))).toBeNull();
    expect(parse(client, "null")).toBeNull();
    expect(parse(client, '"pong"')).toBeNull();
  });

  it("returns typed messages unchanged", () => {
    const message = { type: "room:event", roomId: "room-1", event: "join", hubId: "hub-b" };
    expect(parse(new RelayClient(), JSON.stringify(message))).toEqual(message);
  });
});

describe("RelayClient subscriptions", () => {
  it("stops notifying a listener after it unsubscribes", () => {
    const client = new RelayClient();
    const listener = vi.fn();
    const unsubscribe = client.onRoomEvent(listener);
    const handleMessage = bindHandleMessage(client);

    handleMessage({ type: "room:event", roomId: "room-1", event: "join", hubId: "hub-b" });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    handleMessage({ type: "room:event", roomId: "room-1", event: "leave", hubId: "hub-b" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("RelayClient reconnect backoff", () => {
  type ReconnectFields = {
    reconnectAttempts: number;
    reconnectTimer?: unknown;
  };
  const fields = (client: RelayClient): ReconnectFields => client as unknown as ReconnectFields;
  const scheduleReconnect = (client: RelayClient): void =>
    (client as unknown as { scheduleReconnect(): void }).scheduleReconnect();

  function reconnectingClient(openSocket = vi.fn().mockResolvedValue(undefined)): {
    client: RelayClient;
    openSocket: ReturnType<typeof vi.fn>;
  } {
    const client = new RelayClient();
    configure(client, {
      url: "ws://relay.example/ws",
      hubId: "hub-a",
      token: "token",
      shouldReconnect: true,
      openSocket,
    });
    return { client, openSocket };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("switches to reconnecting and schedules a reconnecting openSocket", () => {
    vi.useFakeTimers();
    const { client, openSocket } = reconnectingClient();
    const states: string[] = [];
    client.onStateChange((state) => states.push(state));

    scheduleReconnect(client);

    expect(states).toEqual(["reconnecting"]);
    expect(fields(client).reconnectAttempts).toBe(1);
    expect(fields(client).reconnectTimer).toBeDefined();
    vi.runOnlyPendingTimers();
    expect(openSocket).toHaveBeenCalledOnce();
    expect(openSocket).toHaveBeenCalledWith(true);

    client.disconnect();
  });

  it("waits 1000ms before the first reconnect attempt", () => {
    vi.useFakeTimers();
    const { client, openSocket } = reconnectingClient();

    scheduleReconnect(client);
    vi.advanceTimersByTime(999);
    expect(openSocket).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(openSocket).toHaveBeenCalledOnce();
    expect(openSocket).toHaveBeenCalledWith(true);

    client.disconnect();
  });

  it("doubles the delay for each previous attempt", () => {
    vi.useFakeTimers();
    const { client, openSocket } = reconnectingClient();
    configure(client, { reconnectAttempts: 2 });

    scheduleReconnect(client);
    vi.advanceTimersByTime(3_999);
    expect(openSocket).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(openSocket).toHaveBeenCalledOnce();
    expect(fields(client).reconnectAttempts).toBe(3);

    client.disconnect();
  });

  it("caps the reconnect delay at 30000ms", () => {
    vi.useFakeTimers();
    const { client, openSocket } = reconnectingClient();
    configure(client, { reconnectAttempts: 10 });

    scheduleReconnect(client);
    vi.advanceTimersByTime(29_999);
    expect(openSocket).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(openSocket).toHaveBeenCalledOnce();

    client.disconnect();
  });

  it("reschedules with a doubled delay when a reconnect attempt fails", async () => {
    vi.useFakeTimers();
    const { client, openSocket } = reconnectingClient(
      vi.fn().mockRejectedValue(new Error("relay down")),
    );

    scheduleReconnect(client);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(openSocket).toHaveBeenCalledOnce();
    expect(fields(client).reconnectAttempts).toBe(2);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(openSocket).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(openSocket).toHaveBeenCalledTimes(2);
    expect(openSocket).toHaveBeenNthCalledWith(2, true);

    client.disconnect();
  });

  it("stops the reconnect chain on disconnect", async () => {
    vi.useFakeTimers();
    const { client, openSocket } = reconnectingClient(
      vi.fn().mockRejectedValue(new Error("relay down")),
    );

    scheduleReconnect(client);
    client.disconnect();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(openSocket).not.toHaveBeenCalled();
    expect(fields(client).reconnectTimer).toBeUndefined();
    expect(client.state).toBe("disconnected");
  });

  it("resets attempts and clears a pending reconnect timer on connect", async () => {
    vi.useFakeTimers();
    const { client, openSocket } = reconnectingClient();
    configure(client, { reconnectAttempts: 3 });

    scheduleReconnect(client);
    expect(fields(client).reconnectAttempts).toBe(4);
    await client.connect("ws://relay.example/ws", "hub-a", "token");

    expect(fields(client).reconnectAttempts).toBe(0);
    expect(fields(client).reconnectTimer).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(openSocket).toHaveBeenCalledOnce();
    expect(openSocket).toHaveBeenCalledWith(false);
    expect(openSocket).not.toHaveBeenCalledWith(true);

    client.disconnect();
  });
});

describe("RelayClient heartbeat pong timeout", () => {
  type HeartbeatFields = { pingSentAt: number | null };
  const fields = (client: RelayClient): HeartbeatFields => client as unknown as HeartbeatFields;
  const startHeartbeat = (client: RelayClient): void =>
    (client as unknown as { startHeartbeat(): void }).startHeartbeat();
  const receivedPong = (client: RelayClient): void =>
    (client as unknown as { receivedPong(): void }).receivedPong();

  function fakeSocket(readyState: number = WebSocket.OPEN): {
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  } {
    return { readyState, send: vi.fn(), terminate: vi.fn(), close: vi.fn() };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a ping and records pingSentAt after one heartbeat interval", () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const client = new RelayClient();
    const socket = fakeSocket();
    configure(client, { socket });
    startHeartbeat(client);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);

    expect(socket.send).toHaveBeenCalledOnce();
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "ping" }));
    expect(fields(client).pingSentAt).toBe(100_000 + HEARTBEAT_INTERVAL_MS);

    client.disconnect();
  });

  it("terminates the socket when no pong arrives before the timeout", () => {
    vi.useFakeTimers();
    const client = new RelayClient();
    const socket = fakeSocket();
    configure(client, { socket });
    startHeartbeat(client);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS - 1);
    expect(socket.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(socket.terminate).toHaveBeenCalledOnce();

    client.disconnect();
  });

  it("does not terminate the socket when a pong arrives in time", () => {
    vi.useFakeTimers();
    const client = new RelayClient();
    const socket = fakeSocket();
    configure(client, { socket });
    startHeartbeat(client);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS - 1);
    receivedPong(client);
    vi.advanceTimersByTime(PONG_TIMEOUT_MS + 1);

    expect(socket.terminate).not.toHaveBeenCalled();
    expect(fields(client).pingSentAt).toBeNull();

    client.disconnect();
  });

  it("skips the ping while the socket is not open", () => {
    vi.useFakeTimers();
    const client = new RelayClient();
    const socket = fakeSocket(WebSocket.CONNECTING);
    configure(client, { socket });
    startHeartbeat(client);

    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS + PONG_TIMEOUT_MS);

    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(fields(client).pingSentAt).toBeNull();

    client.disconnect();
  });
});
