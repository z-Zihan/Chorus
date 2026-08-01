import type { HubEnvelope, RelayServerMessage } from "@agentlink/shared";
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
  ): void {
    const forwarded: HubEnvelope = { ...envelope, relayTimestamp: Date.now() };
    const payload: RelayServerMessage = { type: "message", envelope: forwarded };

    if (forwarded.to.startsWith("room:")) {
      const roomId = forwarded.to.slice("room:".length);
      const room = this.roomManager.getRoom(roomId);
      if (!room) throw new Error("Room not found");
      for (const member of this.roomManager.getMembers(roomId)) {
        const socket = registry.getSocket(member.hubId);
        if (!socket || !sendJson(socket, payload)) offlineStore.store(forwarded, member.hubId);
      }
      return;
    }

    if (forwarded.to === "broadcast") {
      for (const hub of registry.listOnline()) sendJson(hub.socket, payload);
      return;
    }

    const recipient = registry.getSocket(forwarded.to);
    if (!recipient || !sendJson(recipient, payload)) offlineStore.store(forwarded, forwarded.to);
  }
}
