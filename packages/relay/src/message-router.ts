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
      let delivered = false;
      let queued = false;
      for (const member of this.roomManager.getMembers(roomId)) {
        if (registry.isBlocked(forwarded.from, member.hubId)) continue;
        const socket = registry.getSocket(member.hubId);
        if (!socket || !sendJson(socket, payload)) {
          offlineStore.store(forwarded, member.hubId);
          queued = true;
        } else {
          delivered = true;
        }
      }
      return delivered ? "delivered" : queued ? "queued" : "blocked";
    }

    if (forwarded.to === "broadcast") {
      let delivered = false;
      for (const hub of registry.listOnline()) {
        if (registry.isBlocked(forwarded.from, hub.hubId)) continue;
        delivered = sendJson(hub.socket, payload) || delivered;
      }
      return delivered ? "delivered" : "blocked";
    }

    if (registry.isBlocked(forwarded.from, forwarded.to)) return "blocked";

    const recipient = registry.getSocket(forwarded.to);
    if (!recipient || !sendJson(recipient, payload)) {
      offlineStore.store(forwarded, forwarded.to);
      return "queued";
    }
    return "delivered";
  }
}
