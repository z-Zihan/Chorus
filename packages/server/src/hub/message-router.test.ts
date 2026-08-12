import type { HubEnvelope, HubPayload } from "@chorus/shared";
import { describe, expect, it, vi } from "vitest";
import type { AgentRegistry } from "../agent/registry.js";
import type { AgentRuntime } from "../agent/runtime.js";
import type { Repository } from "../db/repository.js";
import type { ConnectionManager } from "./connection-manager.js";
import { decryptPayload, encryptPayload, generateHubKeypair, signEnvelope } from "./crypto.js";
import type { DirectoryService } from "./directory.js";
import type { HubIdentity } from "./identity.js";
import { HubMessageRouter } from "./message-router.js";
import { OfflineStore } from "./offline-store.js";
import type { RelayClient } from "./relay-client.js";
import { TrustStore } from "./trust-store.js";

describe("HubMessageRouter trust checks", () => {
  it("drops an envelope from a blocked Hub before decrypting or dispatching it", async () => {
    const relayClient = {
      onMessage: vi.fn(),
      onOfflineMessages: vi.fn(),
      onPresence: vi.fn(),
    } as unknown as RelayClient;
    const registry = {
      getHubPublicKey: vi.fn(),
      setHubPublicKey: vi.fn(),
    } as unknown as AgentRegistry;
    const runtime = {
      handleHubMessage: vi.fn(),
      handleRemoteA2ACall: vi.fn(),
    } as unknown as AgentRuntime;
    const trustStore = new TrustStore();
    trustStore.block("blocked-hub");
    const router = new HubMessageRouter(
      {} as HubIdentity,
      registry,
      runtime,
      relayClient,
      {} as ConnectionManager,
      { id: "local-user", name: "Local User" },
      {} as DirectoryService,
      trustStore,
      { getAgentRow: vi.fn() } as unknown as Repository,
    );
    const envelope: HubEnvelope = {
      id: "message-1",
      from: "blocked-hub",
      to: "local-hub",
      type: "direct",
      timestamp: Date.now(),
      nonce: "invalid",
      ciphertext: "invalid",
      signature: "invalid",
    };

    await expect(router.onEnvelope(envelope, relayClient)).resolves.toBeUndefined();
    expect(registry.getHubPublicKey).not.toHaveBeenCalled();
    expect(runtime.handleHubMessage).not.toHaveBeenCalled();
    expect(runtime.handleRemoteA2ACall).not.toHaveBeenCalled();
  });
});

describe("HubMessageRouter transport state", () => {
  it("keeps Relay delivery separate from encrypted execution acknowledgements", () => {
    let onTransportStatus:
      | ((update: {
          messageId: string;
          status: "queued" | "delivered" | "failed";
          timestamp: number;
        }) => void)
      | undefined;
    const relayClient = {
      onMessage: vi.fn(),
      onOfflineMessages: vi.fn(),
      onPresence: vi.fn(),
      onTransportStatus: vi.fn((listener) => {
        onTransportStatus = listener;
        return () => undefined;
      }),
    } as unknown as RelayClient;
    const store = new OfflineStore();
    const envelope: HubEnvelope = {
      id: "envelope-1",
      from: "local-hub",
      to: "remote-hub",
      type: "direct",
      timestamp: 1_000,
      nonce: "nonce",
      ciphertext: "ciphertext",
      signature: "signature",
    };
    store.queue(envelope, "local-hub", "remote-hub");
    const router = new HubMessageRouter(
      {} as HubIdentity,
      {} as AgentRegistry,
      {} as AgentRuntime,
      relayClient,
      {} as ConnectionManager,
      { id: "local-user", name: "Local User" },
      {} as DirectoryService,
      new TrustStore(),
      { listRoomIds: vi.fn(() => []) } as unknown as Repository,
      undefined,
      store,
    );

    onTransportStatus?.({ messageId: envelope.id, status: "queued", timestamp: 1_100 });
    expect(store.get(envelope.id)?.status).toBe("queued");
    onTransportStatus?.({ messageId: envelope.id, status: "delivered", timestamp: 1_200 });
    expect(store.get(envelope.id)?.status).toBe("delivered");
    onTransportStatus?.({ messageId: envelope.id, status: "failed", timestamp: 1_300 });
    expect(store.get(envelope.id)?.status).toBe("error");
    router.destroy();
  });
});

describe("HubMessageRouter execution acknowledgements", () => {
  it("emits accepted and done separately from the transport receipt", async () => {
    const sender = await generateHubKeypair();
    const recipient = await generateHubKeypair();
    const sent: HubEnvelope[] = [];
    const relayClient = {
      onMessage: vi.fn(),
      onOfflineMessages: vi.fn(),
      onPresence: vi.fn(),
      onTransportStatus: vi.fn(),
    } as unknown as RelayClient;
    const registry = {
      getHubPublicKey: vi.fn(() => sender.publicKey),
      setHubPublicKey: vi.fn(),
      isHubInRoom: vi.fn(() => true),
    } as unknown as AgentRegistry;
    const runtime = {
      handleHubMessage: vi.fn().mockResolvedValue("Remote result"),
    } as unknown as AgentRuntime;
    const connectionManager = {
      getActivePath: vi.fn(() => "relay"),
      sendEnvelope: vi.fn(async (_hubId: string, envelope: HubEnvelope) => {
        sent.push(envelope);
        return true;
      }),
    } as unknown as ConnectionManager;
    const trustStore = new TrustStore();
    trustStore.completePairing(sender.publicKey, {
      userId: "remote-user",
      userName: "Remote User",
      userPublicKey: sender.publicKey,
    });
    const router = new HubMessageRouter(
      {
        hubId: recipient.publicKey,
        getPublicKey: () => recipient.publicKey,
        getSecretKey: async () => recipient.secretKey,
      } as HubIdentity,
      registry,
      runtime,
      relayClient,
      connectionManager,
      { id: "local-user", name: "Local User" },
      {} as DirectoryService,
      trustStore,
      {
        getAgentRow: vi.fn(),
        listRoomIds: vi.fn(() => []),
        listConversations: vi.fn(() => [
          { id: "local-room", type: "cross_hub", relayRoomId: "conversation-1" },
        ]),
      } as unknown as Repository,
    );
    const payload: HubPayload = {
      protocolVersion: 2,
      messageType: "chat",
      conversationId: "conversation-1",
      messageId: "payload-1",
      content: "Hello",
      fromUserId: "remote-user",
      fromUserName: "Remote User",
    };
    const encrypted = await encryptPayload(payload, recipient.publicKey, sender.secretKey);
    const unsigned: Omit<HubEnvelope, "signature"> = {
      id: "envelope-1",
      from: sender.publicKey,
      to: recipient.publicKey,
      type: "direct",
      timestamp: 1_000,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
    };
    const envelope: HubEnvelope = {
      ...unsigned,
      signature: await signEnvelope(unsigned, sender.secretKey),
    };

    await router.onEnvelope(envelope, relayClient);
    const outboundPayloads = await Promise.all(
      sent.map((item) =>
        decryptPayload<HubPayload>(
          item.ciphertext,
          item.nonce,
          recipient.publicKey,
          sender.secretKey,
        ),
      ),
    );
    expect(outboundPayloads.map((item) => [item.messageType, item.metadata?.status])).toEqual([
      ["delivery_ack", "accepted"],
      ["delivery_ack", "done"],
      ["chat", undefined],
    ]);
    expect(outboundPayloads[0]?.metadata).toMatchObject({
      envelopeId: envelope.id,
      messageId: payload.messageId,
    });
    router.destroy();
  });
});
