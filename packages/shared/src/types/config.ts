import type { AgentConfig } from "./agent";

export interface HistoryTruncationConfig {
  maxMessages: number;
  maxTokens: number;
}

export interface AppConfig {
  port: number;
  dbPath: string;
  cors: { origin: string[] };
  auth: { enabled: boolean; token?: string };
  history: HistoryTruncationConfig;
  agents: AgentConfig[];
}
