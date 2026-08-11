import type { HubEnvelope, RelayServerMessage } from "@chorus/shared";
import type { HubRegistry } from "./hub-registry.js";
import type { OfflineStore } from "./offline-store.js";
import type { RoomManager } from "./room-manager.js";
import { sendJson } from "./socket.js";

export class MessageRouter {
  constructor(private readonly roomManager: RoomManager) {}

  routeMessage(
    envelope: HubEnvelope,
    registry: HubRegistry,
    offlineStore: OfflineStore,
  ): "delivered" | "queued" | "blocked" {
    const forwarded: HubEnvelope = { ...envelope, relayTimestamp: Date.now() };
    const payload: RelayServerMessage = { type: "message", envelope: forwarded };

    if (forwarded.to.startsWith("room:")) {
      const roomId = forwarded.to.slice("room:".length);
      const room = this.roomManager.getRoom(roomId);
      if (!room) throw new Error("Room not found");
      if (!this.roomManager.isMember(roomId, forwarded.from)) {
        throw new Error("Room membership required to send messages");
      }
      let delivered = false;
      let queued = false;
      for (const member of this.roomManager.getMembers(roomId)) {
        if (member.hubId === forwarded.from) continue;
        if (registry.isBlocked(forwarded.from, member.hubId)) continue;
        offlineStore.store(forwarded, member.hubId);
        const socket = registry.getSocket(member.hubId);
        if (!socket || !sendJson(socket, payload)) queued = true;
        else {
          delivered = true;
        }
      }
      return delivered ? "delivered" : queued ? "queued" : "blocked";
    }

    if (forwarded.to === "broadcast") {
      return "blocked";
    }

    if (registry.isBlocked(forwarded.from, forwarded.to)) return "blocked";

    offlineStore.store(forwarded, forwarded.to);
    const recipient = registry.getSocket(forwarded.to);
    if (!recipient || !sendJson(recipient, payload)) return "queued";
    return "delivered";
  }
}
