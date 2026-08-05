import type { HubEnvelope } from "@agentlink/shared";
import type { P2PListener } from "./p2p-listener.js";
import type { RelayClient } from "./relay-client.js";

export type ConnectionPath = "p2p" | "relay" | "none";

export interface ConnectionInfo {
  path: ConnectionPath;
  p2pLatency: number | null;
  relayLatency: number | null;
}

export class ConnectionManager {
  constructor(
    private readonly p2pListener: P2PListener,
    private readonly relayClient: RelayClient,
  ) {}

  getActivePath(hubId: string): ConnectionPath {
    if (this.isP2PAvailable(hubId)) return "p2p";
    if (this.relayClient.state === "connected") return "relay";
    return "none";
  }

  isP2PAvailable(hubId: string): boolean {
    return this.p2pListener.isConnected(hubId);
  }

  async sendEnvelope(hubId: string, envelope: HubEnvelope): Promise<boolean> {
    if (await this.p2pListener.sendToHub(hubId, envelope)) return true;
    if (this.relayClient.state !== "connected") return false;
    this.relayClient.sendEnvelope(envelope);
    return true;
  }

  getConnectionInfo(hubId: string): ConnectionInfo {
    return {
      path: this.getActivePath(hubId),
      p2pLatency: this.p2pListener.getP2PLatency(hubId),
      relayLatency: null,
    };
  }
}
