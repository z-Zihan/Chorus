import { randomUUID } from "node:crypto";
import type { ConversationContext, HubEnvelope, HubPayload } from "@agentlink/shared";
import type { AgentRegistry } from "../agent/registry.js";
import type { AgentRuntime } from "../agent/runtime.js";
import { logger } from "../utils/logger.js";
import { decryptPayload, encryptPayload, signEnvelope, verifySignature } from "./crypto.js";
import type { HubIdentity } from "./identity.js";
import type { RelayClient } from "./relay-client.js";

const REMOTE_CALL_TIMEOUT_MS = 120_000;
const MAX_SEEN_MESSAGES = 1_000;

interface PendingMessage {
  resolve: (content: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  abort?: () => void;
}

type OutboundMessage = string | HubPayload;

export class HubMessageRouter {
  private readonly pendingOutbound = new Map<string, PendingMessage>();
  private readonly seenMessageIds = new Set<string>();

  constructor(
    private readonly identity: HubIdentity,
    private readonly registry: AgentRegistry,
    private readonly runtime: AgentRuntime,
    private readonly relayClient: RelayClient,
  ) {
    relayClient.onMessage((envelope) => {
      void this.onEnvelope(envelope, relayClient).catch((error: unknown) => {
        logger.warn({ err: error, envelopeId: envelope.id }, "Unable to route Hub envelope");
      });
    });
    relayClient.onOfflineMessages((envelopes) => {
      void this.routeOfflineMessages(envelopes);
    });
  }

  get pendingCount(): number {
    return this.pendingOutbound.size;
  }

  async onEnvelope(envelope: HubEnvelope, relayClient: RelayClient): Promise<void> {
    if (this.seenMessageIds.has(envelope.id)) return;
    this.rememberMessage(envelope.id);

    const senderPublicKey = this.registry.getHubPublicKey(envelope.from) ?? envelope.from;
    this.registry.setHubPublicKey(envelope.from, senderPublicKey);
    const validSignature = await verifySignature(
      signingData(envelope),
      envelope.signature,
      senderPublicKey,
    );
    if (!validSignature) throw new Error(`Invalid Hub envelope signature from ${envelope.from}`);

    const payload = await decryptPayload<HubPayload>(
      envelope.ciphertext,
      envelope.nonce,
      senderPublicKey,
      this.identity.getSecretKey(),
    );

    const correlationId = stringMetadata(payload.metadata, "correlationId")
      ?? stringMetadata(payload.metadata, "replyTo");
    if (correlationId && (payload.messageType === "a2a_response" || payload.messageType === "chat")) {
      const error = payload.metadata?.error === true
        ? new Error(payload.content || "Remote Agent call failed")
        : undefined;
      this.settlePending(correlationId, payload.content, error);
      return;
    }

    if (payload.messageType === "a2a_call") {
      await this.handleInboundA2A(envelope.from, payload, relayClient);
    } else if (payload.messageType === "chat") {
      await this.handleInboundChat(envelope.from, payload, relayClient);
    }
  }

  async handleOutbound(
    toHubId: string,
    message: OutboundMessage,
    conversationId: string,
  ): Promise<string> {
    const recipientPublicKey = this.registry.getHubPublicKey(toHubId) ?? toHubId;
    const payload: HubPayload = typeof message === "string"
      ? {
          messageType: "chat",
          conversationId,
          messageId: randomUUID(),
          content: message,
        }
      : { ...message, conversationId };
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
    this.relayClient.sendEnvelope(envelope);
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
    const payload: HubPayload = {
      messageType: "a2a_call",
      conversationId: context.conversationId,
      messageId,
      content: message,
      agentId: fromAgentId,
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
    const targetAgentId = stringMetadata(payload.metadata, "targetAgentId");
    if (!targetAgentId) throw new Error("Inbound A2A call has no targetAgentId");
    const callStack = Array.isArray(payload.metadata?.callStack)
      ? payload.metadata.callStack.filter((value): value is string => typeof value === "string")
      : [payload.agentId ?? `${fromHubId}:remote`];
    try {
      const content = await this.runtime.handleRemoteA2ACall(
        payload.agentId ?? `${fromHubId}:remote`,
        targetAgentId,
        payload.content,
        {
          conversationId: payload.conversationId,
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
      const targetAgentId = stringMetadata(payload.metadata, "targetAgentId");
      const content = await this.runtime.handleHubMessage(
        payload.conversationId,
        payload.content,
        targetAgentId,
      );
      await this.sendResponse(fromHubId, payload, content, false, relayClient, "chat");
    } catch (error) {
      const content = error instanceof Error ? error.message : String(error);
      await this.sendResponse(fromHubId, payload, content, true, relayClient, "chat");
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
    await this.handleOutbound(toHubId, {
      messageType,
      conversationId: request.conversationId,
      messageId: randomUUID(),
      content,
      metadata: { correlationId: request.messageId, error },
    }, request.conversationId);
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
