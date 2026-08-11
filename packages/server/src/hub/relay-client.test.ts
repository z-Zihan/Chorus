import type { RelayServerMessage } from "@chorus/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelayClient } from "./relay-client.js";

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
