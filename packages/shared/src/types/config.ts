import type { AgentConfig } from "./agent";

export interface HistoryTruncationConfig {
  maxMessages: number;
  maxTokens: number;
}

export interface HubRelayConfig {
  /** Relay Server WebSocket URL */
  url: string;
  /** 首次注册后自动填充 */
  token?: string;
}

export interface HubP2PConfig {
  /** 是否启用 P2P */
  enabled: boolean;
  /** P2P WebSocket 监听端口 */
  port: number;
  /** 发现方式 */
  discovery: "mdns" | "none";
}

export interface HubConfig {
  /** 是否启用跨 Hub 通信 */
  enabled: boolean;
  /** 显示名 */
  displayName: string;
  /** Relay 配置 */
  relay: HubRelayConfig;
  /** P2P 配置 */
  p2p: HubP2PConfig;
}

export interface AppConfig {
  /** Local HTTP server bind address. Defaults to loopback for desktop safety. */
  host?: string;
  port: number;
  dbPath: string;
  cors: { origin: string[] };
  auth: { enabled: boolean; tokens: Record<string, string> };
  history: HistoryTruncationConfig;
  agents: AgentConfig[];
  /** 跨 Hub 通信配置 */
  hub?: HubConfig;
}
