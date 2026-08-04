import type { HubEnvelope, RoomMember } from "./hub";

export interface RoomCasState {
  revision: number;
  keyEpoch: number;
}

export interface RoomCasResult extends RoomCasState {
  accepted: boolean;
}

/**
 * Hub → Relay 的 WebSocket 消息
 */
export type RelayClientMessage =
  | { type: "register"; hubId: string; token: string }
  | { type: "message"; envelope: HubEnvelope }
  | { type: "presence"; status: "online" | "offline" }
  | { type: "room:join"; roomId: string }
  | { type: "room:leave"; roomId: string }
  | {
      type: "room_cas";
      roomId: string;
      expectedRevision: number;
      expectedKeyEpoch: number;
      newRevision: number;
      newKeyEpoch: number;
    }
  | { type: "ping" };

/**
 * Relay → Hub 的 WebSocket 消息
 */
export type RelayServerMessage =
  | { type: "registered"; relayHubId: string }
  | { type: "message"; envelope: HubEnvelope }
  | { type: "offline_messages"; envelopes: HubEnvelope[] }
  | {
      type: "presence";
      hubId: string;
      status: "online" | "offline";
      publicKey?: string;
    }
  | {
      type: "room:event";
      roomId: string;
      event: "join" | "leave" | "invite";
      hubId: string;
    }
  | { type: "room:members"; roomId: string; members: RoomMember[] }
  | ({ type: "room_cas_result"; roomId: string } & RoomCasResult)
  | { type: "pong" };
