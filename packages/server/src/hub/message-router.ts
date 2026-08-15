import { randomUUID } from "node:crypto";
import type {
  ConversationContext,
  HubEnvelope,
  HubPayload,
  TransportReceipt,
} from "@chorus/shared";
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
import { ResyncService } from "./resync.js";
import type { PairingService } from "./pairing-service.js";

const DEFAULT_REMOTE_CALL_TIMEOUT_MS = 5 * 60_000;
const MIN_REMOTE_CALL_TIMEOUT_MS = 60_000;
const MAX_REMOTE_CALL_TIMEOUT_MS = 30 * 60_000;
const MAX_SEEN_MESSAGES = 1_000;
const OFFLINE_PURGE_INTERVAL_MS = 60 * 60 * 1000;

interface PendingMessage {
  resolve: (content: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  abort?: () => void;
}

type DeliveryStatusListener = (update: {
  transport?: "queued" | "delivered" | "failed";
  execution?: "accepted" | "denied" | "done" | "error";
}) => void;

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
  private readonly outboundPayloadByEnvelope = new Map<string, string>();
  private readonly deliveryListeners = new Map<
    string,
    {
      listener: DeliveryStatusListener;
      transportTerminal: boolean;
      executionTerminal: boolean;
    }
  >();
  private readonly offlineHubIds = new Set<string>();
  private readonly authorizationService: AuthorizationService;
  private readonly resyncService: ResyncService;
  private readonly offlinePurgeTimer: NodeJS.Timeout;
  private p2pListener?: P2PListener;
  private removeP2PMessageListener?: () => void;
  private removeRelayStateListener?: () => void;
  private removeRoomMembersListener?: () => void;
  private removeTransportStatusListener?: () => void;

  constructor(
    private readonly identity: HubIdentity,
    private readonly registry: AgentRegistry,
    private readonly runtime: AgentRuntime,
    private readonly relayClient: RelayClient,
    private readonly connectionManager: ConnectionManager,
    private readonly localUser: LocalUserIdentity,
    private readonly directoryService: DirectoryService,
    private readonly trustStore: TrustStore,
    private readonly repository: Repository,
    private readonly pairingService?: PairingService,
    private readonly offlineStore = new OfflineStore(),
  ) {
    this.authorizationService = new AuthorizationService(trustStore, repository, registry);
    this.resyncService = new ResyncService(
      repository,
      relayClient,
      (toHubId, payload, roomId) => this.handleOutbound(toHubId, payload, roomId),
      identity.hubId,
      (ownerId) =>
        repository.getUser(ownerId)?.publicKey ??
        trustStore.listTrusted().find((hub) => hub.userId === ownerId)?.userPublicKey,
    );
    this.offlineStore.purgeExpired();
    this.offlinePurgeTimer = setInterval(() => {
      const purged = this.offlineStore.purgeExpired();
      if (purged > 0) logger.info({ purged }, "Purged expired offline Hub messages");
    }, OFFLINE_PURGE_INTERVAL_MS);
    this.offlinePurgeTimer.unref();
    relayClient.onMessage((envelope) => {
      void this.processRelayEnvelope(envelope);
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
    this.removeRelayStateListener = relayClient.onStateChange?.((state) => {
      if (state !== "connected") return;
      for (const roomId of repository.listRoomIds()) relayClient.joinRoom(roomId);
      void this.resyncService.requestAllRooms().catch((error: unknown) => {
        logger.warn({ err: error }, "Unable to request Room resync after Relay connection");
      });
    });
    this.removeRoomMembersListener = relayClient.onRoomMembers?.((roomId) => {
      if (!repository.listRoomIds().includes(roomId)) return;
      void this.resyncService.requestResync(roomId).catch((error: unknown) => {
        logger.warn({ err: error, roomId }, "Unable to request Room resync");
      });
    });
    this.removeTransportStatusListener = relayClient.onTransportStatus?.((update) => {
      if (update.status === "delivered") this.offlineStore.markDelivered(update.messageId);
      else if (update.status === "failed")
        this.offlineStore.markComplete(update.messageId, "error");
      const payloadMessageId = this.outboundPayloadByEnvelope.get(update.messageId);
      if (payloadMessageId) {
        this.emitDeliveryStatus(payloadMessageId, { transport: update.status });
        if (update.status === "delivered" || update.status === "failed") {
          this.outboundPayloadByEnvelope.delete(update.messageId);
        }
        if (update.status === "failed") {
          this.settlePending(payloadMessageId, "", new Error("Relay delivery failed"));
        }
      }
    });
  }

  get pendingCount(): number {
    return this.pendingOutbound.size;
  }

  destroy(): void {
    clearInterval(this.offlinePurgeTimer);
    this.removeRelayStateListener?.();
    this.removeRoomMembersListener?.();
    this.removeTransportStatusListener?.();
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
    if (envelope.type === "pairing") {
      if (!this.pairingService) throw new Error("Pairing service is unavailable");
      await this.pairingService.onEnvelope(envelope);
      return;
    }
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
      await this.identity.getSecretKey(),
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
      await this.sendDeliveryAck(envelope.from, payload, envelope.id, "denied");
      return;
    }

    const correlationId =
      stringMetadata(payload.metadata, "correlationId") ??
      stringMetadata(payload.metadata, "replyTo");
    if (
      correlationId &&
      (payload.messageType === "a2a_response" || payload.messageType === "chat")
    ) {
      const error =
        payload.metadata?.error === true
          ? new Error(payload.content || "Remote Agent call failed")
          : undefined;
      this.settlePending(correlationId, payload.content ?? "", error);
      return;
    }

    if (payload.messageType === "a2a_call") {
      await this.sendDeliveryAck(envelope.from, payload, envelope.id, "accepted");
      await this.handleInboundA2A(envelope.from, envelope.id, payload, relayClient);
    } else if (payload.messageType === "chat") {
      await this.sendDeliveryAck(envelope.from, payload, envelope.id, "accepted");
      await this.handleInboundChat(envelope.from, envelope.id, payload, relayClient);
    } else if (payload.messageType === "directory_request") {
      await this.handleDirectoryRequest(envelope.from, payload);
    } else if (
      payload.messageType === "directory_announce" ||
      payload.messageType === "directory_revoke"
    ) {
      this.handleDirectoryUpdate(envelope.from, payload);
    } else if (payload.messageType === "delivery_ack") {
      this.handleDeliveryAck(payload);
    } else if (payload.messageType === "resync_request") {
      await this.handleResyncRequest(envelope.from, payload);
    } else if (payload.messageType === "resync_response") {
      if (!payload.resyncResponse) throw new Error("Inbound resync response has no payload");
      this.resyncService.handleResyncResponse(payload.resyncResponse);
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
    const localConversation = this.repository.getConversation?.(conversationId);
    const protocolConversationId = localConversation?.relayRoomId ?? conversationId;
    const payload: HubPayload = {
      ...outbound,
      conversationId: protocolConversationId,
      protocolVersion: 2,
      fromUserId: this.localUser.id,
      fromUserName: this.localUser.name,
    };
    const encrypted = await encryptPayload(
      payload,
      recipientPublicKey,
      await this.identity.getSecretKey(),
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
      signature: await signEnvelope(signingData(unsigned), await this.identity.getSecretKey()),
    };
    if (this.pendingOutbound.has(payload.messageId)) {
      this.outboundPayloadByEnvelope.set(envelope.id, payload.messageId);
    }
    const activePath = this.connectionManager.getActivePath(toHubId);
    const hasP2PConnection = activePath === "p2p";
    if (activePath !== "p2p") {
      this.offlineStore.queue(envelope, this.identity.hubId, toHubId);
    }
    if (
      (this.offlineHubIds.has(toHubId) && !hasP2PConnection) ||
      !(await this.connectionManager.sendEnvelope(toHubId, envelope))
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
    onDeliveryStatus?: DeliveryStatusListener,
  ): Promise<string> {
    const messageId = randomUUID();
    if (onDeliveryStatus) {
      this.deliveryListeners.set(messageId, {
        listener: onDeliveryStatus,
        transportTerminal: false,
        executionTerminal: false,
      });
    }
    const response = this.waitForResponse(
      messageId,
      context.signal,
      normalizeRemoteCallTimeout(context.a2aCallTimeoutMs),
    );
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
        maxA2ARounds: context.maxA2ARounds,
        a2aCallTimeoutMs: context.a2aCallTimeoutMs,
      },
    };
    try {
      await this.handleOutbound(toHubId, payload, context.conversationId);
    } catch (error) {
      this.settlePending(messageId, "", error instanceof Error ? error : new Error(String(error)));
    }
    return response;
  }

  private async handleInboundA2A(
    fromHubId: string,
    envelopeId: string,
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
      const content = await this.runtime.handleRemoteA2ACall(fromAgentId, targetAgentId, message, {
        conversationId,
        history: [],
        callStack,
        a2aThreadId: stringMetadata(payload.metadata, "a2aThreadId"),
        maxA2ARounds: numberMetadata(payload.metadata, "maxA2ARounds"),
        a2aCallTimeoutMs: timeoutMetadata(payload.metadata, "a2aCallTimeoutMs"),
      });
      await this.sendDeliveryAck(fromHubId, payload, envelopeId, "done");
      await this.sendResponse(fromHubId, payload, content, false, relayClient);
    } catch (error) {
      const content = error instanceof Error ? error.message : String(error);
      await this.sendDeliveryAck(fromHubId, payload, envelopeId, "error");
      await this.sendResponse(fromHubId, payload, content, true, relayClient);
    }
  }

  private async handleInboundChat(
    fromHubId: string,
    envelopeId: string,
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
      await this.sendDeliveryAck(fromHubId, payload, envelopeId, "done");
      await this.sendResponse(fromHubId, payload, content, false, relayClient, "chat");
    } catch (error) {
      const content = error instanceof Error ? error.message : String(error);
      await this.sendDeliveryAck(fromHubId, payload, envelopeId, "error");
      await this.sendResponse(fromHubId, payload, content, true, relayClient, "chat");
    }
  }

  private async handleDirectoryRequest(fromHubId: string, request: HubPayload): Promise<void> {
    const requestedRoomId = stringMetadata(request.metadata, "roomId");
    const sharedRoom = Boolean(
      requestedRoomId &&
      this.registry.isHubInRoom(requestedRoomId, fromHubId) &&
      this.repository
        .listConversations({ type: "cross_hub" })
        .some((conversation) => conversation.relayRoomId === requestedRoomId),
    );
    const directory = await this.directoryService.buildSignedLocalDirectory({
      trusted: false,
      sharedRoom,
    });
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
    const envelopeId = stringMetadata(payload.metadata, "envelopeId");
    const messageId =
      envelopeId ??
      stringMetadata(payload.metadata, "messageId") ??
      stringMetadata(payload.metadata, "correlationId") ??
      stringMetadata(payload.metadata, "replyTo") ??
      payload.content ??
      payload.messageId;
    const status = stringMetadata(payload.metadata, "status") ?? "accepted";
    if (status === "accepted" || status === "denied") {
      this.offlineStore.markSettled(messageId, status);
    } else if (status === "done" || status === "error") {
      this.offlineStore.markComplete(messageId, status);
    } else {
      logger.warn({ messageId, status }, "Ignoring delivery ACK with invalid status");
      return;
    }
    const payloadMessageId =
      stringMetadata(payload.metadata, "messageId") ??
      (envelopeId ? this.outboundPayloadByEnvelope.get(envelopeId) : undefined);
    if (payloadMessageId) {
      this.emitDeliveryStatus(payloadMessageId, {
        execution: status as "accepted" | "denied" | "done" | "error",
      });
      if (status === "denied") {
        this.settlePending(payloadMessageId, "", new Error("Remote Hub denied the request"));
      }
    }
  }

  private async sendDeliveryAck(
    toHubId: string,
    request: HubPayload,
    envelopeId: string,
    status: "accepted" | "denied" | "done" | "error",
  ): Promise<void> {
    await this.handleOutbound(
      toHubId,
      {
        messageType: "delivery_ack",
        messageId: randomUUID(),
        conversationId: request.conversationId,
        toUserId: request.fromUserId,
        metadata: {
          envelopeId,
          messageId: request.messageId,
          status,
        },
      },
      request.conversationId ?? request.messageId,
    );
  }

  private async handleResyncRequest(fromHubId: string, payload: HubPayload): Promise<void> {
    if (!payload.resyncRequest) throw new Error("Inbound resync request has no payload");
    const response = this.resyncService.handleResyncRequest(payload.resyncRequest);
    await this.handleOutbound(
      fromHubId,
      {
        messageType: "resync_response",
        messageId: randomUUID(),
        conversationId: response.roomId,
        toUserId: payload.fromUserId,
        resyncResponse: response,
        metadata: { correlationId: payload.messageId },
      },
      response.roomId,
    );
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

  private waitForResponse(
    messageId: string,
    signal?: AbortSignal,
    timeoutMs = DEFAULT_REMOTE_CALL_TIMEOUT_MS,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settlePending(
          messageId,
          "",
          new Error(`Remote Agent call timed out after ${Math.ceil(timeoutMs / 60_000)} minutes`),
        );
      }, timeoutMs);
      timer.unref();
      const pending: PendingMessage = { resolve, reject, timer, signal };
      if (signal) {
        pending.abort = () => {
          const reason =
            signal.reason instanceof Error
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

  private emitDeliveryStatus(
    messageId: string,
    update: Parameters<DeliveryStatusListener>[0],
  ): void {
    const delivery = this.deliveryListeners.get(messageId);
    if (!delivery) return;
    delivery.listener(update);
    if (update.transport === "delivered" || update.transport === "failed") {
      delivery.transportTerminal = true;
    }
    if (update.execution && ["denied", "done", "error"].includes(update.execution)) {
      delivery.executionTerminal = true;
    }
    if (
      update.transport === "failed" ||
      (delivery.transportTerminal && delivery.executionTerminal)
    ) {
      this.deliveryListeners.delete(messageId);
    }
  }

  private async routeOfflineMessages(envelopes: HubEnvelope[]): Promise<void> {
    for (const envelope of envelopes) {
      await this.processRelayEnvelope(envelope);
    }
  }

  private async processRelayEnvelope(envelope: HubEnvelope): Promise<void> {
    try {
      await this.onEnvelope(envelope, this.relayClient);
      this.relayClient.sendTransportReceipt(await this.createTransportReceipt(envelope.id));
    } catch (error) {
      logger.warn({ err: error, envelopeId: envelope.id }, "Unable to route Hub envelope");
    }
  }

  private async createTransportReceipt(messageId: string): Promise<TransportReceipt> {
    const unsigned = {
      messageId,
      recipientHubId: this.identity.hubId,
      status: "persisted" as const,
      timestamp: Date.now(),
    };
    return {
      ...unsigned,
      signature: await signEnvelope(unsigned, await this.identity.getSecretKey()),
    };
  }

  private async deliverPendingForHub(hubId: string): Promise<void> {
    for (const message of this.offlineStore.getPendingForHub(hubId)) {
      if (!(await this.connectionManager.sendEnvelope(hubId, message.envelope))) return;
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

function signingData(
  envelope: Omit<HubEnvelope, "signature"> | HubEnvelope,
): Omit<HubEnvelope, "signature" | "relayTimestamp"> {
  return {
    id: envelope.id,
    from: envelope.from,
    to: envelope.to,
    type: envelope.type,
    timestamp: envelope.timestamp,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
  };
}

function stringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 50
    ? value
    : undefined;
}

function timeoutMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_REMOTE_CALL_TIMEOUT_MS &&
    value <= MAX_REMOTE_CALL_TIMEOUT_MS
    ? value
    : undefined;
}

function normalizeRemoteCallTimeout(value: number | undefined): number {
  return timeoutMetadata({ value }, "value") ?? DEFAULT_REMOTE_CALL_TIMEOUT_MS;
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
