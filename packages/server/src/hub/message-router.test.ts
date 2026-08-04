import type { HubEnvelope } from "@agentlink/shared";
import { describe, expect, it, vi } from "vitest";
import type { AgentRegistry } from "../agent/registry.js";
import type { AgentRuntime } from "../agent/runtime.js";
import type { ConnectionManager } from "./connection-manager.js";
import type { DirectoryService } from "./directory.js";
import type { HubIdentity } from "./identity.js";
import { HubMessageRouter } from "./message-router.js";
import type { RelayClient } from "./relay-client.js";
import { TrustStore } from "./trust-store.js";

describe("HubMessageRouter trust checks", () => {
  it("drops an envelope from a blocked Hub before decrypting or dispatching it", async () => {
    const relayClient = {
      onMessage: vi.fn(),
      onOfflineMessages: vi.fn(),
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
