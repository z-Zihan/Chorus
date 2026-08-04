export type HubConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export type P2PConnectionState =
  | "disconnected"
  | "connecting"
  | "authenticated"
  | "error";

export interface P2PDiscoveredHub {
  hubId: string;
  displayName: string;
  host: string;
  port: number;
  txt: Record<string, string>;
}

export interface HubInfo {
  hubId: string;
  displayName: string;
  online: boolean;
  publicKey?: string;
}

/**
 * Hub 身份信息
 */
export interface HubIdentity {
  /** Ed25519 公钥完整 hex */
  hubId: string;
  /** Ed25519 公钥 hex */
  publicKey: string;
  /** 用户自定义显示名 */
  displayName: string;
  /** 是否在线 */
  online?: boolean;
}

/**
 * Hub 间传输层消息信封
 *
 * 所有跨 Hub 的消息都封装在 HubEnvelope 中传输。
 * Relay 只能看到元数据 + ciphertext，无法解密内容。
 */
export interface HubEnvelope {
  /** UUID v7（时序可排序） */
  id: string;
  /** 发送方 Hub ID */
  from: string;
  /** 接收方 Hub ID | "room:xxx" | "broadcast" */
  to: string;
  /** 消息类型 */
  type: "direct" | "group" | "broadcast" | "presence" | "discovery";
  /** 发送方 Unix ms */
  timestamp: number;
  /** 防重放 nonce (base64, 24 bytes) */
  nonce: string;
  /** 加密后的 payload (base64) */
  ciphertext: string;
  /** 发送方 Ed25519 签名 (base64) */
  signature: string;
  /** Relay 转发时附加的时间戳，用于跨 Hub 排序兜底 */
  relayTimestamp?: number;
}

/**
 * 解密后的消息 payload
 */
export interface HubPayload {
  /** 协议版本 */
  protocolVersion: 2;
  /** 消息语义类型 */
  messageType:
    | "chat"
    | "a2a_call"
    | "a2a_response"
    | "agent_status"
    | "typing"
    | "directory_request"
    | "directory_announce"
    | "directory_revoke"
    | "delivery_ack";
  /** 会话 ID */
  conversationId?: string;
  /** 消息 ID */
  messageId: string;
  /** 消息内容 */
  content?: string;
  /** 来源 User ID */
  fromUserId: string;
  /** 来源 User 展示名，不用于授权 */
  fromUserName: string;
  /** 目标 User ID */
  toUserId?: string;
  /** 来源 Agent ID */
  fromAgentId?: string;
  /** 目标 Agent ID */
  toAgentId?: string;
  /** v1 兼容字段；读取时解释为 fromAgentId */
  agentId?: string;
  /** User/Agent 目录声明 */
  directory?: DirectoryManifest;
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
}

export interface DirectoryManifest {
  schemaVersion: 1;
  directoryVersion: number;
  issuedAt: number;
  expiresAt: number;
  user: {
    id: string;
    name: string;
    avatar?: string;
    hubId: string;
    publicKey: string;
  };
  agents: Array<{
    id: string;
    name: string;
    description?: string;
    type: string;
    capabilities: string[];
    status: "online" | "busy" | "offline" | "error";
    visibility: "trusted" | "room" | "public";
  }>;
  revokedAgentIds: string[];
  signature: string;
}

/**
 * 群聊房间成员信息
 *
 * 包含公钥，发送方据此逐个加密 payload。
 */
export interface RoomMember {
  /** Hub ID (Ed25519 公钥 hex) */
  hubId: string;
  /** Ed25519 公钥 hex */
  publicKey: string;
  /** 显示名 */
  displayName: string;
  /** 是否在线 */
  online: boolean;
}

/**
 * 群聊房间信息
 */
export interface RoomInfo {
  id: string;
  name: string;
  members: RoomMember[];
  createdAt: number;
  createdBy: string;
}
