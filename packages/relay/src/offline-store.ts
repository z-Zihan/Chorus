import type { HubEnvelope } from "@agentlink/shared";
import { asc, eq, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DatabaseContext } from "./db/index.js";
import { offlineMessages } from "./db/schema.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

function configuredTtlDays(): number {
  const value = Number.parseInt(process.env.RELAY_OFFLINE_TTL_DAYS ?? "7", 10);
  return Number.isFinite(value) && value > 0 ? value : 7;
}

export class OfflineStore {
  private readonly ttlMs: number;

  constructor(
    private readonly database: DatabaseContext,
    ttlDays = configuredTtlDays(),
  ) {
    this.ttlMs = ttlDays * DAY_MS;
  }

  store(envelope: HubEnvelope, toHubId: string): void {
    const now = Date.now();
    this.database.db.insert(offlineMessages).values({
      id: nanoid(),
      toHubId,
      envelope: JSON.stringify(envelope),
      createdAt: now,
      expiresAt: now + this.ttlMs,
    }).run();
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
    return this.database.db
      .delete(offlineMessages)
      .where(lt(offlineMessages.expiresAt, Date.now()))
      .run().changes;
  }
}
