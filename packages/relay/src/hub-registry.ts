import { and, eq, or } from "drizzle-orm";
import type { DatabaseContext } from "./db/index.js";
import { hubBlocks, hubs } from "./db/schema.js";
import type { RelaySocket } from "./socket.js";

export type HubRecord = typeof hubs.$inferSelect;

export class HubRegistry {
  private readonly sockets = new Map<string, RelaySocket>();
  private shuttingDown = false;

  constructor(private readonly database: DatabaseContext) {
    database.db.update(hubs).set({ online: false, updatedAt: Date.now() }).run();
  }

  register(hubId: string, publicKey: string, displayName: string): HubRecord {
    const now = Date.now();
    const authVersion = (this.get(hubId)?.authVersion ?? 0) + 1;
    this.database.db
      .insert(hubs)
      .values({
        hubId,
        publicKey,
        displayName,
        online: false,
        authVersion,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: hubs.hubId,
        set: { publicKey, displayName, authVersion, updatedAt: now },
      })
      .run();
    const hub = this.get(hubId);
    if (!hub) throw new Error("Hub registration failed");
    return hub;
  }

  get(hubId: string): HubRecord | null {
    return this.database.db.select().from(hubs).where(eq(hubs.hubId, hubId)).get() ?? null;
  }

  setOnline(hubId: string, socket: RelaySocket): void {
    this.sockets.set(hubId, socket);
    this.database.db
      .update(hubs)
      .set({ online: true, updatedAt: Date.now() })
      .where(eq(hubs.hubId, hubId))
      .run();
  }

  setOffline(hubId: string): void {
    this.sockets.delete(hubId);
    if (this.shuttingDown) return;
    this.database.db
      .update(hubs)
      .set({ online: false, updatedAt: Date.now() })
      .where(eq(hubs.hubId, hubId))
      .run();
  }

  shutdown(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.database.db.update(hubs).set({ online: false, updatedAt: Date.now() }).run();
    for (const socket of this.sockets.values()) socket.close(1001, "Relay shutting down");
    this.sockets.clear();
  }

  getSocket(hubId: string): RelaySocket | null {
    return this.sockets.get(hubId) ?? null;
  }

  blockHub(hubId: string, blockedHubId: string): void {
    this.database.db
      .insert(hubBlocks)
      .values({ hubId, blockedHubId, createdAt: Date.now() })
      .onConflictDoNothing()
      .run();
  }

  /** Clear persisted blocks involving a Hub only when that Hub is unregistered. */
  unblockHub(hubId: string): void {
    this.database.db
      .delete(hubBlocks)
      .where(or(eq(hubBlocks.hubId, hubId), eq(hubBlocks.blockedHubId, hubId)))
      .run();
  }

  /** Blocks are symmetric for routing even though only one side installs them. */
  isBlocked(fromHubId: string, toHubId: string): boolean {
    return Boolean(
      this.database.db
        .select({ hubId: hubBlocks.hubId })
        .from(hubBlocks)
        .where(
          or(
            and(eq(hubBlocks.hubId, fromHubId), eq(hubBlocks.blockedHubId, toHubId)),
            and(eq(hubBlocks.hubId, toHubId), eq(hubBlocks.blockedHubId, fromHubId)),
          ),
        )
        .get(),
    );
  }

  list(): HubRecord[] {
    return this.database.db.select().from(hubs).all();
  }

  listOnline(): Array<HubRecord & { socket: RelaySocket }> {
    const online: Array<HubRecord & { socket: RelaySocket }> = [];
    for (const hub of this.list()) {
      const socket = this.sockets.get(hub.hubId);
      if (hub.online && socket) online.push({ ...hub, socket });
    }
    return online;
  }

  unregister(hubId: string): boolean {
    const socket = this.sockets.get(hubId);
    socket?.close(1000, "Hub deregistered");
    this.sockets.delete(hubId);
    this.unblockHub(hubId);
    return this.database.db.delete(hubs).where(eq(hubs.hubId, hubId)).run().changes > 0;
  }
}
