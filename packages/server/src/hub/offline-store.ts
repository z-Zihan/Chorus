import type { HubEnvelope } from "@chorus/shared";
import { DEFAULT_OFFLINE_RETENTION_MS } from "@chorus/shared";

export type DeliveryStatus = "queued" | "delivered" | "accepted" | "denied" | "done" | "error";

export interface OfflineMessage {
  id: string;
  fromHubId: string;
  toHubId: string;
  envelope: HubEnvelope;
  status: DeliveryStatus;
  queuedAt: number;
  deliveredAt?: number;
  settledAt?: number;
  expiresAt: number;
}

export const DEFAULT_OFFLINE_TTL_MS = DEFAULT_OFFLINE_RETENTION_MS;

export class OfflineStore {
  private readonly messages = new Map<string, OfflineMessage>();

  constructor(
    private readonly ttlMs = DEFAULT_OFFLINE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Queue a message for offline delivery. Duplicate envelope IDs are idempotent. */
  queue(envelope: HubEnvelope, fromHubId: string, toHubId: string): OfflineMessage {
    const existing = this.messages.get(envelope.id);
    if (existing) return existing;

    const queuedAt = this.now();
    const message: OfflineMessage = {
      id: envelope.id,
      fromHubId,
      toHubId,
      envelope,
      status: "queued",
      queuedAt,
      expiresAt: queuedAt + this.ttlMs,
    };
    this.messages.set(message.id, message);
    return message;
  }

  /** Mark as delivered (the Hub came online and the message was sent). */
  markDelivered(messageId: string): void {
    const message = this.messages.get(messageId);
    if (!message || !["queued", "delivered"].includes(message.status)) return;
    message.status = "delivered";
    message.deliveredAt ??= this.now();
  }

  /** Mark as accepted or denied by the recipient. Terminal: no flipping between settled states. */
  markSettled(messageId: string, status: "accepted" | "denied"): void {
    const message = this.messages.get(messageId);
    if (!message || !["queued", "delivered"].includes(message.status)) return;
    message.status = status;
    message.settledAt = this.now();
  }

  /** Mark as done or error after processing. Never overrides a settled denial. */
  markComplete(messageId: string, status: "done" | "error"): void {
    const message = this.messages.get(messageId);
    if (!message || message.status === "denied") return;
    if (message.status === "done" || message.status === "error") return;
    message.status = status;
    message.settledAt = this.now();
  }

  /**
   * A transport failure is a network condition, not a business outcome: fall
   * back to queued so the message is retried (the receiver's envelope dedup
   * keeps the resend from re-executing the agent).
   */
  markRetryable(messageId: string): void {
    const message = this.messages.get(messageId);
    if (!message || message.status !== "delivered") return;
    message.status = "queued";
    message.deliveredAt = undefined;
  }

  /** Get unacknowledged messages for a Hub in FIFO order. */
  getPendingForHub(hubId: string): OfflineMessage[] {
    return [...this.messages.values()]
      .filter(
        (message) =>
          message.toHubId === hubId &&
          message.expiresAt > this.now() &&
          (message.status === "queued" || message.status === "delivered"),
      )
      .sort((left, right) => left.queuedAt - right.queuedAt);
  }

  /** Purge messages whose TTL has elapsed. */
  purgeExpired(): number {
    const now = this.now();
    let purged = 0;
    for (const [id, message] of this.messages) {
      if (message.expiresAt > now) continue;
      this.messages.delete(id);
      purged += 1;
    }
    return purged;
  }

  /** Check if a message with this envelope ID is already known. */
  has(messageId: string): boolean {
    return this.messages.has(messageId);
  }

  get(messageId: string): OfflineMessage | undefined {
    const message = this.messages.get(messageId);
    return message ? { ...message, envelope: { ...message.envelope } } : undefined;
  }
}
