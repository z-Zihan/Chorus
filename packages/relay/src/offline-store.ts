import type { HubEnvelope } from "@chorus/shared";
import { DEFAULT_OFFLINE_RETENTION_MS } from "@chorus/shared";
import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DatabaseContext } from "./db/index.js";
import { offlineMessages } from "./db/schema.js";

export const DEFAULT_RETENTION_MS = DEFAULT_OFFLINE_RETENTION_MS;
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
    if (Buffer.byteLength(serializedEnvelope, "utf8") > this.maxMessageSize) {
      throw new Error(`Message exceeds maximum size of ${this.maxMessageSize} bytes`);
    }
    const now = Date.now();
    this.database.sqlite.transaction(() => {
      const existing = this.database.db
        .select({ id: offlineMessages.id })
        .from(offlineMessages)
        .where(
          and(
            eq(offlineMessages.toHubId, toHubId),
            sql`json_extract(${offlineMessages.envelope}, '$.id') = ${envelope.id}`,
          ),
        )
        .get();
      if (existing) return;
      this.database.db
        .insert(offlineMessages)
        .values({
          id: nanoid(),
          toHubId,
          envelope: serializedEnvelope,
          createdAt: now,
          expiresAt: now + this.retentionMs,
        })
        .run();
      this.trimExcessForHub(toHubId);
    })();
  }

  getForHub(hubId: string): HubEnvelope[] {
    const rows = this.database.db
      .select()
      .from(offlineMessages)
      .where(and(eq(offlineMessages.toHubId, hubId), gt(offlineMessages.expiresAt, Date.now())))
      .orderBy(asc(offlineMessages.createdAt))
      .all();
    return rows.flatMap((row) => {
      try {
        return [JSON.parse(row.envelope) as HubEnvelope];
      } catch {
        return [];
      }
    });
  }

  /** Delete a persisted envelope only after transport delivery succeeds. */
  ackMessage(messageId: string, toHubId: string): number {
    if (!messageId || !toHubId) return 0;
    return this.database.db
      .delete(offlineMessages)
      .where(
        and(
          eq(offlineMessages.toHubId, toHubId),
          sql`json_extract(${offlineMessages.envelope}, '$.id') = ${messageId}`,
        ),
      )
      .run().changes;
  }

  getEnvelope(messageId: string, toHubId: string): HubEnvelope | undefined {
    const row = this.database.db
      .select({ envelope: offlineMessages.envelope })
      .from(offlineMessages)
      .where(
        and(
          eq(offlineMessages.toHubId, toHubId),
          sql`json_extract(${offlineMessages.envelope}, '$.id') = ${messageId}`,
        ),
      )
      .get();
    if (!row) return undefined;
    try {
      return JSON.parse(row.envelope) as HubEnvelope;
    } catch {
      return undefined;
    }
  }

  hasMessage(messageId: string): boolean {
    return Boolean(
      this.database.db
        .select({ id: offlineMessages.id })
        .from(offlineMessages)
        .where(sql`json_extract(${offlineMessages.envelope}, '$.id') = ${messageId}`)
        .get(),
    );
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
    return this.database.sqlite
      .prepare(
        `
      DELETE FROM offline_messages
      WHERE id IN (
        SELECT id
        FROM offline_messages
        WHERE to_hub_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT -1 OFFSET ?
      )
    `,
      )
      .run(hubId, this.maxMessagesPerHub).changes;
  }
}
