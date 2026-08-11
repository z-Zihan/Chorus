import type { HubEnvelope, RoomMember } from "./hub";

export interface RoomCasState {
  revision: number;
  keyEpoch: number;
}

export interface RoomCasResult extends RoomCasState {
  accepted: boolean;
}

/** Recipient-signed plaintext proof that an envelope was durably handled. */
export interface TransportReceipt {
  messageId: string;
  recipientHubId: string;
  status: "persisted";
  timestamp: number;
  signature: string;
}

/** Relay-generated sender update. This never describes Agent execution. */
export interface TransportStatusUpdate {
  messageId: string;
  status: "queued" | "delivered" | "failed";
  timestamp: number;
}

export type RoomInvitationStatus = "pending" | "accepted" | "declined" | "revoked" | "expired";

export interface RoomInvitation {
  roomId: string;
  roomName: string;
  inviteeHubId: string;
  invitedByHubId: string;
  invitedByName?: string;
  status: RoomInvitationStatus;
  createdAt: number;
  expiresAt: number;
  respondedAt?: number;
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
  | { type: "contact_block"; blockedHubId: string }
  | {
      type: "room_cas";
      roomId: string;
      expectedRevision: number;
      expectedKeyEpoch: number;
      newRevision: number;
      newKeyEpoch: number;
    }
  | ({ type: "transport_receipt" } & TransportReceipt)
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
      displayName?: string;
    }
  | {
      type: "room:event";
      roomId: string;
      event: "join" | "leave" | "invite";
      hubId: string;
    }
  | { type: "room:members"; roomId: string; members: RoomMember[] }
  | ({ type: "room_cas_result"; roomId: string } & RoomCasResult)
  | ({ type: "transport_status" } & TransportStatusUpdate)
  | { type: "contact_block_ack"; blockedHubId: string; success: boolean }
  | { type: "pong" };
