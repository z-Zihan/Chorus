import { randomUUID } from "node:crypto";
import type { ConversationContext, HubEnvelope, HubPayload } from "@agentlink/shared";
import type { AgentRegistry } from "../agent/registry.js";
import type { AgentRuntime } from "../agent/runtime.js";
import type { Repository } from "../db/repository.js";
import { logger } from "../utils/logger.js";
import { AuthorizationService } from "./authorization.js";
import { decryptPayload, encryptPayload, signEnvelope, verifySignature } from "./crypto.js";
import type { ConnectionManager } from "./connection-manager.js";
import type { HubIdentity } from "./identity.js";
import type { P2PListener } from "./p2p-listener.js";
import { normalizeHubPayload, rejectIncompatibleVersion } from "./payload-compat.js";
import type { RelayClient } from "./relay-client.js";
import type { DirectoryService } from "./directory.js";
import type { TrustStore } from "./trust-store.js";
import { OfflineStore } from "./offline-store.js";

const REMOTE_CALL_TIMEOUT_MS = 120_000;
const MAX_SEEN_MESSAGES = 1_000;
const OFFLINE_PURGE_INTERVAL_MS = 60 * 60 * 1000;

interface PendingMessage {
  resolve: (content: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  abort?: () => void;
}

type OutboundPayload = Omit<
  HubPayload,
  "protocolVersion" | "fromUserId" | "fromUserName" | "agentId"
>;
type OutboundMessage = string | OutboundPayload;

interface LocalUserIdentity {
  id: string;
  name: string;
}

export class HubMessageRouter {
  private readonly pendingOutbound = new Map<string, PendingMessage>();
  private readonly seenMessageIds = new Set<string>();
  private readonly offlineHubIds = new Set<string>();
  private readonly authorizationService: AuthorizationService;
  private readonly offlinePurgeTimer: NodeJS.Timeout;
  private p2pListener?: P2PListener;
  private removeP2PMessageListener?: () => void;

  constructor(
    private readonly identity: HubIdentity,
    private readonly registry: AgentRegistry,
    private readonly runtime: AgentRuntime,
    private readonly relayClient: RelayClient,
    private readonly connectionManager: ConnectionManager,
    private readonly localUser: LocalUserIdentity,
    private readonly directoryService: DirectoryService,
    private readonly trustStore: TrustStore,
    repository: Repository,
    private readonly offlineStore = new OfflineStore(),
  ) {
    this.authorizationService = new AuthorizationService(trustStore, repository);
    this.offlineStore.purgeExpired();
    this.offlinePurgeTimer = setInterval(() => {
      const purged = this.offlineStore.purgeExpired();
      if (purged > 0) logger.info({ purged }, "Purged expired offline Hub messages");
    }, OFFLINE_PURGE_INTERVAL_MS);
    this.offlinePurgeTimer.unref();
    relayClient.onMessage((envelope) => {
      void this.onEnvelope(envelope, relayClient).catch((error: unknown) => {
        logger.warn({ err: error, envelopeId: envelope.id }, "Unable to route Hub envelope");
      });
    });
    relayClient.onOfflineMessages((envelopes) => {
      void this.routeOfflineMessages(envelopes);
    });
    relayClient.onPresence((hubId, status) => {
      if (status === "offline") {
        this.offlineHubIds.add(hubId);
        return;
      }
      this.offlineHubIds.delete(hubId);
      void this.deliverPendingForHub(hubId);
    });
  }

  get pendingCount(): number {
    return this.pendingOutbound.size;
  }

  destroy(): void {
    clearInterval(this.offlinePurgeTimer);
  }

  setP2PListener(listener: P2PListener): void {
    this.removeP2PMessageListener?.();
    this.p2pListener = listener;
    this.removeP2PMessageListener = listener.onMessage((hubId, envelope) => {
      if (envelope.from !== hubId || envelope.to !== this.identity.hubId) {
        logger.warn({ hubId, envelopeId: envelope.id }, "Ignoring invalid P2P envelope routing");
        return;
      }
      void this.onEnvelope(envelope, this.relayClient).catch((error: unknown) => {
        logger.warn({ err: error, envelopeId: envelope.id }, "Unable to route P2P Hub envelope");
      });
    });
  }

  async onEnvelope(envelope: HubEnvelope, relayClient: RelayClient): Promise<void> {
    if (this.seenMessageIds.has(envelope.id)) return;
    this.rememberMessage(envelope.id);

    const trustedHub = this.trustStore.get(envelope.from);
    if (!trustedHub || trustedHub.trustLevel === "blocked") {
      logger.warn(
        { fromHubId: envelope.from, trustLevel: trustedHub?.trustLevel ?? "unknown" },
        "Dropping message from an untrusted Hub",
      );
      return;
    }

    const senderPublicKey = this.registry.getHubPublicKey(envelope.from) ?? envelope.from;
    this.registry.setHubPublicKey(envelope.from, senderPublicKey);
    const validSignature = await verifySignature(
      signingData(envelope),
      envelope.signature,
      senderPublicKey,
    );
    if (!validSignature) throw new Error(`Invalid Hub envelope signature from ${envelope.from}`);

    const rawPayload = await decryptPayload<Record<string, unknown>>(
      envelope.ciphertext,
      envelope.nonce,
      senderPublicKey,
      this.identity.getSecretKey(),
    );
    if (rejectIncompatibleVersion(rawPayload as unknown as HubPayload)) {
      throw new Error(
        `Unsupported Hub payload protocol version: ${String(rawPayload.protocolVersion)}`,
      );
    }
    const payload = normalizeHubPayload(rawPayload);

    const authorization = this.authorizationService.authorize(envelope.from, payload);
    if (!authorization.allowed) {
      logger.warn(
        {
          fromHubId: envelope.from,
          messageType: payload.messageType,
          reason: authorization.reason,
        },
        "Dropping unauthorized inbound Hub message",
      );
      return;
    }

    const correlationId = stringMetadata(payload.metadata, "correlationId")
      ?? stringMetadata(payload.metadata, "replyTo");
    if (correlationId && (payload.messageType === "a2a_response" || payload.messageType === "chat")) {
      const error = payload.metadata?.error === true
        ? new Error(payload.content || "Remote Agent call failed")
        : undefined;
      this.settlePending(correlationId, payload.content ?? "", error);
      return;
    }

    if (payload.messageType === "a2a_call") {
      await this.handleInboundA2A(envelope.from, payload, relayClient);
    } else if (payload.messageType === "chat") {
      await this.handleInboundChat(envelope.from, payload, relayClient);
    } else if (payload.messageType === "directory_request") {
      await this.handleDirectoryRequest(envelope.from, payload);
    } else if (
      payload.messageType === "directory_announce"
      || payload.messageType === "directory_revoke"
    ) {
      this.handleDirectoryUpdate(envelope.from, payload);
    } else if (payload.messageType === "delivery_ack") {
      this.handleDeliveryAck(payload);
    }
  }

  async handleOutbound(
    toHubId: string,
    message: OutboundMessage,
    conversationId: string,
  ): Promise<string> {
    const recipientPublicKey = this.registry.getHubPublicKey(toHubId) ?? toHubId;
    const outbound: OutboundPayload =
      typeof message === "string"
        ? {
            messageType: "chat",
            conversationId,
            messageId: randomUUID(),
            content: message,
          }
        : { ...message, conversationId };
    const payload: HubPayload = {
      ...outbound,
      protocolVersion: 2,
      fromUserId: this.localUser.id,
      fromUserName: this.localUser.name,
    };
    const encrypted = await encryptPayload(
      payload,
      recipientPublicKey,
      this.identity.getSecretKey(),
    );
    const unsigned: Omit<HubEnvelope, "signature"> = {
      id: randomUUID(),
      from: this.identity.getPublicKey(),
      to: toHubId,
      type: "direct",
      timestamp: Date.now(),
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
    };
    const envelope: HubEnvelope = {
      ...unsigned,
      signature: await signEnvelope(signingData(unsigned), this.identity.getSecretKey()),
    };
    const hasP2PConnection = this.connectionManager.getActivePath(toHubId) === "p2p";
    if (
      (this.offlineHubIds.has(toHubId) && !hasP2PConnection)
      || !this.connectionManager.sendEnvelope(toHubId, envelope)
    ) {
      this.offlineStore.queue(envelope, this.identity.hubId, toHubId);
      logger.info({ toHubId, envelopeId: envelope.id }, "Queued message for offline Hub");
    }
    return payload.messageId;
  }

  async callRemoteAgent(
    toHubId: string,
    fromAgentId: string,
    toAgentId: string,
    message: string,
    context: ConversationContext,
  ): Promise<string> {
    const messageId = randomUUID();
    const response = this.waitForResponse(messageId, context.signal);
    const payload: OutboundPayload = {
      messageType: "a2a_call",
      conversationId: context.conversationId,
      messageId,
      content: message,
      fromAgentId,
      toAgentId,
      metadata: {
        targetAgentId: toAgentId,
        callStack: context.callStack,
        a2aThreadId: context.a2aThreadId,
      },
    };
    try {
      await this.handleOutbound(toHubId, payload, context.conversationId);
    } catch (error) {
      this.settlePending(
        messageId,
        "",
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    return response;
  }

  private async handleInboundA2A(
    fromHubId: string,
    payload: HubPayload,
    relayClient: RelayClient,
  ): Promise<void> {
    const targetAgentId = payload.toAgentId ?? stringMetadata(payload.metadata, "targetAgentId");
    if (!targetAgentId) throw new Error("Inbound A2A call has no targetAgentId");
    const conversationId = requiredString(payload.conversationId, "conversationId", "A2A call");
    const message = requiredString(payload.content, "content", "A2A call");
    const fromAgentId = payload.fromAgentId ?? `${fromHubId}:remote`;
    const callStack = Array.isArray(payload.metadata?.callStack)
      ? payload.metadata.callStack.filter((value): value is string => typeof value === "string")
      : [fromAgentId];
    try {
      const content = await this.runtime.handleRemoteA2ACall(
        fromAgentId,
        targetAgentId,
        message,
        {
          conversationId,
          history: [],
          callStack,
          a2aThreadId: stringMetadata(payload.metadata, "a2aThreadId"),
        },
      );
      await this.sendResponse(fromHubId, payload, content, false, relayClient);
    } catch (error) {
      const content = error instanceof Error ? error.message : String(error);
      await this.sendResponse(fromHubId, payload, content, true, relayClient);
    }
  }

  private async handleInboundChat(
    fromHubId: string,
    payload: HubPayload,
    relayClient: RelayClient,
  ): Promise<void> {
    try {
      const conversationId = requiredString(
        payload.conversationId,
        "conversationId",
        "chat message",
      );
      const message = requiredString(payload.content, "content", "chat message");
      const targetAgentId = payload.toAgentId ?? stringMetadata(payload.metadata, "targetAgentId");
      const content = await this.runtime.handleHubMessage(conversationId, message, targetAgentId);
      await this.sendResponse(fromHubId, payload, content, false, relayClient, "chat");
    } catch (error) {
      const content = error instanceof Error ? error.message : String(error);
      await this.sendResponse(fromHubId, payload, content, true, relayClient, "chat");
    }
  }

  private async handleDirectoryRequest(fromHubId: string, request: HubPayload): Promise<void> {
    const directory = await this.directoryService.buildSignedLocalDirectory();
    if (!directory) {
      logger.warn({ fromHubId }, "Unable to answer directory request without a signed directory");
      return;
    }
    await this.handleOutbound(
      fromHubId,
      {
        messageType: "directory_announce",
        messageId: randomUUID(),
        toUserId: request.fromUserId,
        directory,
        metadata: { correlationId: request.messageId },
      },
      request.conversationId ?? request.messageId,
    );
  }

  private handleDirectoryUpdate(fromHubId: string, payload: HubPayload): void {
    const manifest = payload.directory;
    if (!manifest) throw new Error(`Inbound ${payload.messageType} has no directory manifest`);
    if (manifest.user.hubId !== fromHubId) {
      throw new Error(`Directory Hub ID does not match envelope sender ${fromHubId}`);
    }
    if (!this.directoryService.verifyManifest(manifest)) {
      throw new Error(`Invalid directory signature from ${fromHubId}`);
    }
    if (this.directoryService.isExpired(manifest)) {
      throw new Error(`Expired directory manifest from ${fromHubId}`);
    }
    const current = this.directoryService.getRemoteDirectory(fromHubId);
    if (!this.directoryService.isNewer(manifest, current)) {
      logger.debug(
        {
          fromHubId,
          directoryVersion: manifest.directoryVersion,
          currentVersion: current?.directoryVersion,
        },
        "Ignoring stale directory manifest",
      );
      return;
    }
    this.directoryService.applyRemoteDirectory(manifest);
  }

  private handleDeliveryAck(payload: HubPayload): void {
    const messageId = stringMetadata(payload.metadata, "envelopeId")
      ?? stringMetadata(payload.metadata, "messageId")
      ?? stringMetadata(payload.metadata, "correlationId")
      ?? stringMetadata(payload.metadata, "replyTo")
      ?? payload.content
      ?? payload.messageId;
    const status = stringMetadata(payload.metadata, "status") ?? "accepted";
    if (status === "accepted" || status === "denied") {
      this.offlineStore.markSettled(messageId, status);
    } else if (status === "done" || status === "error") {
      this.offlineStore.markComplete(messageId, status);
    } else {
      logger.warn({ messageId, status }, "Ignoring delivery ACK with invalid status");
    }
  }

  private async sendResponse(
    toHubId: string,
    request: HubPayload,
    content: string,
    error: boolean,
    _relayClient: RelayClient,
    messageType: HubPayload["messageType"] = "a2a_response",
  ): Promise<void> {
    await this.handleOutbound(
      toHubId,
      {
        messageType,
        conversationId: request.conversationId,
        messageId: randomUUID(),
        content,
        toUserId: request.fromUserId,
        fromAgentId: request.toAgentId ?? stringMetadata(request.metadata, "targetAgentId"),
        toAgentId: request.fromAgentId,
        metadata: { correlationId: request.messageId, error },
      },
      requiredString(request.conversationId, "conversationId", "response"),
    );
  }

  private waitForResponse(messageId: string, signal?: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settlePending(messageId, "", new Error("Remote Agent call timed out after 120 seconds"));
      }, REMOTE_CALL_TIMEOUT_MS);
      timer.unref();
      const pending: PendingMessage = { resolve, reject, timer, signal };
      if (signal) {
        pending.abort = () => {
          const reason = signal.reason instanceof Error
            ? signal.reason
            : new DOMException("Remote Agent call aborted", "AbortError");
          this.settlePending(messageId, "", reason);
        };
        signal.addEventListener("abort", pending.abort, { once: true });
      }
      this.pendingOutbound.set(messageId, pending);
      if (signal?.aborted) pending.abort?.();
    });
  }

  private settlePending(messageId: string, content: string, error?: Error): void {
    const pending = this.pendingOutbound.get(messageId);
    if (!pending) return;
    this.pendingOutbound.delete(messageId);
    clearTimeout(pending.timer);
    if (pending.signal && pending.abort) pending.signal.removeEventListener("abort", pending.abort);
    if (error) pending.reject(error);
    else pending.resolve(content);
  }

  private async routeOfflineMessages(envelopes: HubEnvelope[]): Promise<void> {
    for (const envelope of envelopes) {
      try {
        await this.onEnvelope(envelope, this.relayClient);
      } catch (error) {
        logger.warn({ err: error, envelopeId: envelope.id }, "Unable to route offline Hub envelope");
      }
    }
  }

  private async deliverPendingForHub(hubId: string): Promise<void> {
    for (const message of this.offlineStore.getPendingForHub(hubId)) {
      if (!this.connectionManager.sendEnvelope(hubId, message.envelope)) return;
      this.offlineStore.markDelivered(message.id);
    }
  }

  private rememberMessage(messageId: string): void {
    this.seenMessageIds.add(messageId);
    if (this.seenMessageIds.size <= MAX_SEEN_MESSAGES) return;
    const oldest = this.seenMessageIds.values().next().value;
    if (oldest) this.seenMessageIds.delete(oldest);
  }
}

function signingData(envelope: Omit<HubEnvelope, "signature"> | HubEnvelope): string {
  return JSON.stringify({
    id: envelope.id,
    from: envelope.from,
    to: envelope.to,
    type: envelope.type,
    timestamp: envelope.timestamp,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
  });
}

function stringMetadata(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredString(
  value: string | undefined,
  field: string,
  payloadDescription: string,
): string {
  if (typeof value !== "string") {
    throw new Error(`Inbound ${payloadDescription} has no ${field}`);
  }
  return value;
}
