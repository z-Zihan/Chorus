import { eq } from "drizzle-orm";
import type { DatabaseContext } from "./db/index.js";
import { hubs } from "./db/schema.js";
import type { RelaySocket } from "./socket.js";

export type HubRecord = typeof hubs.$inferSelect;

export class HubRegistry {
  private readonly sockets = new Map<string, RelaySocket>();

  constructor(private readonly database: DatabaseContext) {
    database.db.update(hubs).set({ online: false, updatedAt: Date.now() }).run();
  }

  register(hubId: string, publicKey: string, displayName: string): HubRecord {
    const now = Date.now();
    this.database.db
      .insert(hubs)
      .values({ hubId, publicKey, displayName, online: false, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: hubs.hubId,
        set: { publicKey, displayName, updatedAt: now },
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
    this.database.db
      .update(hubs)
      .set({ online: false, updatedAt: Date.now() })
      .where(eq(hubs.hubId, hubId))
      .run();
  }

  getSocket(hubId: string): RelaySocket | null {
    return this.sockets.get(hubId) ?? null;
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
    return this.database.db.delete(hubs).where(eq(hubs.hubId, hubId)).run().changes > 0;
  }
}
