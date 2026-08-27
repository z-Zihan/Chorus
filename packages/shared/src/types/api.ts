import type { Agent, AgentType } from "./agent";
import type { Conversation } from "./conversation";
import type { HubConnectionState, RoomMember } from "./hub";

/**
 * REST API response DTOs shared by @chorus/server (producer) and @chorus/web
 * (consumer), so a field change on one side fails the other side's typecheck
 * instead of surfacing as undefined at runtime.
 */

// ─── Agent metrics (GET /api/agents/:id/metrics) ────────────
export interface AgentMetrics {
  totalCalls: number;
  successRate: number;
  avgLatencyMs: number;
  lastCallAt: number | null;
}

// ─── Credentials (GET /api/credentials) ─────────────────────
export type CredentialStorageBackend = "system-keychain" | "file";

export interface CredentialAgentStatus {
  id: string;
  name: string;
}

export interface CredentialStatus {
  backend: CredentialStorageBackend;
  agents: CredentialAgentStatus[];
}

// ─── Pairing (GET /api/hub/pairing/session/:id) ─────────────
export type PairingRole = "initiator" | "responder";
export type PairingStatus =
  | "waiting_peer"
  | "verifying"
  | "awaiting_approval"
  | "trusted"
  | "cancelled"
  | "expired"
  | "failed";

export interface PairingSessionView {
  sessionId: string;
  role: PairingRole;
  remoteHubId: string;
  status: PairingStatus;
  sas?: string;
  expiresAt: number;
  localApproved: boolean;
  peerApproved: boolean;
  remoteUserName?: string;
  error?: string;
}

// ─── Hub status (GET /api/hub/status) ───────────────────────
export interface HubPeerStatus {
  hubId: string;
  displayName: string;
  path: "p2p" | "relay" | "none";
  latency: number | null;
}

export interface HubStatusResponse {
  relayState: HubConnectionState;
  peers: HubPeerStatus[];
}

export interface HubRoom extends Conversation {
  roomId: string;
  members: RoomMember[];
  agents: Agent[];
  revision?: number;
  keyEpoch?: number;
}

// ─── Scheduler (/api/scheduler/tasks) ───────────────────────
export interface ScheduledAgentTask {
  id: string;
  agentId: string;
  conversationId: string;
  cronExpression: string;
  prompt: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number | null;
  lastResult?: string | null;
  nextRunAt?: number | null;
}

export interface CreateScheduledTaskInput {
  agentId: string;
  cronExpression: string;
  prompt: string;
  conversationId?: string;
}

// ─── Catalog (/api/catalog, /api/installations) ─────────────
export type CatalogKind = "detected-cli" | "managed-cli" | "api-connector";
export type CatalogPlatform = "darwin" | "linux" | "win32";
export type InstallMethod = "brew" | "npm" | "winget" | "download" | "pip";

export interface InstallRecipe {
  method: InstallMethod;
  executable: string;
  args: string[];
  requiresElevation: boolean;
}

export interface CatalogEntry {
  id: string;
  name: string;
  summary: string;
  publisher: { name: string; url: string; verified: boolean };
  kind: CatalogKind;
  platforms: CatalogPlatform[];
  capabilities: string[];
  permissions: string[];
  homepage: string;
  license?: string;
  descriptorId?: string;
  installRecipes: InstallRecipe[];
  uninstallRecipes: InstallRecipe[];
  adapterTemplate: { type: AgentType; config: Record<string, unknown> };
}

export interface CatalogEntryWithStatus extends CatalogEntry {
  installed: boolean;
  detected?: boolean;
  agentId?: string;
  disabled?: boolean;
}

export interface InstallOptions {
  recipeMethod?: InstallMethod;
  apiKey?: string;
  config?: Record<string, unknown>;
  acceptPermissions?: boolean;
}

export type InstallationStage =
  "checking" | "downloading" | "installing" | "verifying" | "done" | "error";

export interface InstallationStatus {
  id: string;
  entryId: string;
  stage: InstallationStage;
  progress: number;
  command?: string;
  agentId?: string;
  error?: string;
  cancelled?: boolean;
  startedAt: number;
  updatedAt: number;
}
