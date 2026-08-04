import type { HubEnvelope } from "@agentlink/shared";
import { asc, eq, lte } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DatabaseContext } from "./db/index.js";
import { offlineMessages } from "./db/schema.js";

export const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const DEFAULT_MAX_MESSAGE_SIZE = 256 * 1_024;
export const DEFAULT_MAX_MESSAGES_PER_HUB = 1_000;

export class OfflineStore {
  constructor(
    private readonly database: DatabaseContext,
    readonly retentionMs = DEFAULT_RETENTION_MS,
    readonly maxMessageSize = DEFAULT_MAX_MESSAGE_SIZE,
    readonly maxMessagesPerHub = DEFAULT_MAX_MESSAGES_PER_HUB,
  ) {}

  store(envelope: HubEnvelope, toHubId: string): void {
    const serializedEnvelope = JSON.stringify(envelope);
    if (serializedEnvelope.length > this.maxMessageSize) {
      throw new Error(`Message exceeds maximum size of ${this.maxMessageSize} bytes`);
    }
    const now = Date.now();
    this.database.sqlite.transaction(() => {
      this.database.db.insert(offlineMessages).values({
        id: nanoid(),
        toHubId,
        envelope: serializedEnvelope,
        createdAt: now,
        expiresAt: now + this.retentionMs,
      }).run();
      this.trimExcessForHub(toHubId);
    })();
  }

  getForHub(hubId: string): HubEnvelope[] {
    const transaction = this.database.sqlite.transaction(() => {
      const rows = this.database.db
        .select()
        .from(offlineMessages)
        .where(eq(offlineMessages.toHubId, hubId))
        .orderBy(asc(offlineMessages.createdAt))
        .all();
      this.database.db.delete(offlineMessages).where(eq(offlineMessages.toHubId, hubId)).run();
      return rows;
    });

    return transaction().flatMap((row) => {
      try {
        return [JSON.parse(row.envelope) as HubEnvelope];
      } catch {
        return [];
      }
    });
  }

  cleanupExpired(): number {
    return this.database.sqlite.transaction(() => {
      let removed = this.database.db
        .delete(offlineMessages)
        .where(lte(offlineMessages.expiresAt, Date.now()))
        .run().changes;
      const recipients = this.database.sqlite
        .prepare("SELECT DISTINCT to_hub_id AS toHubId FROM offline_messages")
        .all() as Array<{ toHubId: string }>;
      for (const { toHubId } of recipients) removed += this.trimExcessForHub(toHubId);
      return removed;
    })();
  }

  private trimExcessForHub(hubId: string): number {
    return this.database.sqlite.prepare(`
      DELETE FROM offline_messages
      WHERE id IN (
        SELECT id
        FROM offline_messages
        WHERE to_hub_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT -1 OFFSET ?
      )
    `).run(hubId, this.maxMessagesPerHub).changes;
  }
}
