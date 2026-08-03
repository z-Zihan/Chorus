import { isDeepStrictEqual } from "node:util";
import type {
  AppConfig,
  Agent,
  AgentAdapter,
  AgentConfig,
  AgentStatus,
  AgentStatusSnapshot,
  HubInfo,
  PersistedAgentConfig,
} from "@agentlink/shared";
import type { Repository } from "../db/repository.js";
import { ConfigWatcher } from "../config-watcher.js";
import { logger } from "../utils/logger.js";
import { BaseAdapter, messageFromError } from "./adapter.js";
import { CliAdapter } from "./adapters/cli.js";
import { CustomAdapter } from "./adapters/custom.js";
import { DifyAdapter } from "./adapters/dify.js";
import { MockAdapter } from "./adapters/mock.js";
import { LangChainAdapter } from "./adapters/langchain.js";
import { OpenClawAdapter } from "./adapters/openclaw.js";
import { OpenAIAdapter } from "./adapters/openai.js";
import { AgentPersistence } from "./persistence.js";
import type { RelayClient } from "../hub/relay-client.js";

interface RegistryEntry {
  adapter: AgentAdapter;
  config: AgentConfig;
  persisted: PersistedAgentConfig;
  status: AgentStatus;
  error?: string;
}

export interface RemoteAgent {
  id: string;
  name: string;
  hubId: string;
}

export class AgentRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  readonly friends = new Map<string, Set<string>>();
  private readonly statusListeners = new Set<(status: AgentStatusSnapshot) => void>();
  private readonly persistence: AgentPersistence;
  private readonly configuredAgents = new Map<string, AgentConfig>();
  private readonly healthCheckFailures = new Set<string>();
  private readonly hubPublicKeys = new Map<string, string>();
  private readonly knownHubs = new Map<string, HubInfo>();
  private readonly remoteAgents = new Map<string, RemoteAgent>();
  private configWatcher?: ConfigWatcher;
  private healthCheckTimer?: NodeJS.Timeout;
  private healthCheckRunning = false;

  constructor(
    private readonly repository: Repository,
    relayClient?: RelayClient,
  ) {
    this.persistence = new AgentPersistence(repository);
    this.repository.setAgentStatusResolver((agentId) => this.getStatus(agentId));
    relayClient?.onPresence((hubId, status) => this.setHubPresence(hubId, status));
    relayClient?.onRoomMembers((_roomId, members) => {
      for (const member of members) {
        this.setHubPresence(
          member.hubId,
          member.online ? "online" : "offline",
          member.publicKey,
          member.displayName,
        );
        if (member.hubId !== relayClient.currentHubId) {
          this.registerRemoteAgent(member.hubId, member.hubId, member.displayName);
        }
      }
    });
  }

  getHubPublicKey(hubId: string): string | undefined {
    return this.hubPublicKeys.get(hubId);
  }

  setHubPublicKey(hubId: string, publicKey: string): void {
    this.hubPublicKeys.set(hubId, publicKey);
    const current = this.knownHubs.get(hubId);
    this.knownHubs.set(hubId, {
      hubId,
      displayName: current?.displayName ?? hubId.slice(0, 8),
      online: current?.online ?? false,
      publicKey,
    });
  }

  setHubPresence(
    hubId: string,
    status: "online" | "offline",
    publicKey = hubId,
    displayName?: string,
  ): void {
    this.hubPublicKeys.set(hubId, publicKey);
    const current = this.knownHubs.get(hubId);
    this.knownHubs.set(hubId, {
      hubId,
      displayName: displayName ?? current?.displayName ?? hubId.slice(0, 8),
      online: status === "online",
      publicKey,
    });
  }

  getKnownHubs(): HubInfo[] {
    return [...this.knownHubs.values()];
  }

  registerRemoteAgent(agentId: string, hubId: string, agentName: string): void {
    this.remoteAgents.set(agentId, { id: agentId, name: agentName, hubId });
  }

  getRemoteAgents(): RemoteAgent[] {
    return [...this.remoteAgents.values()];
  }

  getRemoteAgentHub(agentId: string): string | undefined {
    const registered = this.remoteAgents.get(agentId)?.hubId;
    if (registered) return registered;
    for (const hubId of this.hubPublicKeys.keys()) {
      if (agentId.startsWith(`${hubId}:`) || agentId.startsWith(`${hubId}/`)) return hubId;
    }
    return undefined;
  }

  async initialize(configs: AgentConfig[]): Promise<void> {
    this.loadFriends();
    this.configuredAgents.clear();
    for (const config of configs) this.configuredAgents.set(config.id, config);
    const persistedAgents = await this.persistence.loadPersistedAgents();
    for (const config of configs) {
      const persisted = persistedAgents.find((agent) => agent.id === config.id);
      if (persisted?.disabled) continue;
      await this.registerAndPersist({
        ...config,
        source: "explicit_config",
        managed: false,
        customizedFields: [],
        disabled: false,
      });
    }

    for (const persisted of persistedAgents) {
      if (persisted.disabled || this.entries.has(persisted.id)) continue;
      await this.registerInMemory(persisted);
    }
  }

  addFriend(agentId: string, friendId: string): boolean {
    if (agentId === friendId || !this.get(agentId, true) || !this.get(friendId, true)) return false;
    this.addFriendInMemory(agentId, friendId);
    this.addFriendInMemory(friendId, agentId);
    this.repository.addAgentFriend(agentId, friendId);
    return true;
  }

  removeFriend(agentId: string, friendId: string): boolean {
    const removed = Boolean(this.friends.get(agentId)?.delete(friendId))
      || Boolean(this.friends.get(friendId)?.delete(agentId));
    this.friends.get(agentId)?.delete(friendId);
    this.friends.get(friendId)?.delete(agentId);
    this.repository.removeAgentFriend(agentId, friendId);
    return removed;
  }

  getFriends(agentId: string): string[] {
    return [...(this.friends.get(agentId) ?? [])];
  }

  async register(config: AgentConfig): Promise<Agent> {
    return this.registerAndPersist(config);
  }

  async registerAndPersist(config: AgentConfig | PersistedAgentConfig): Promise<Agent> {
    const persisted = await this.persistence.persistAgent(config);
    return this.registerInMemory(persisted);
  }

  private async registerInMemory(persisted: PersistedAgentConfig): Promise<Agent> {
    const config: AgentConfig = persisted;
    this.entries.get(config.id)?.adapter.destroy?.();
    const adapter = createAdapter(config);
    const entry: RegistryEntry = { adapter, config, persisted, status: "offline" };
    this.entries.set(config.id, entry);
    try {
      await adapter.init(config.config);
      entry.status = "online";
    } catch (error) {
      entry.status = "error";
      entry.error = messageFromError(error);
    }
    this.broadcastStatus(config.id);
    return this.toAgent(entry);
  }

  async update(
    id: string,
    input: Partial<Pick<AgentConfig, "name" | "description" | "avatar" | "config">>,
  ): Promise<Agent | undefined> {
    const current = this.entries.get(id);
    const existing = current?.persisted
      ?? (await this.persistence.loadPersistedAgents()).find((agent) => agent.id === id);
    if (!existing) return undefined;
    const config: AgentConfig = {
      ...existing,
      ...input,
      id,
      config: { ...existing.config, ...input.config },
    };
    const customizedFields = new Set(existing.customizedFields);
    for (const key of Object.keys(input)) customizedFields.add(key);
    const updated = await this.persistence.persistAgent({
      ...existing,
      ...config,
      customizedFields: [...customizedFields],
    });
    return updated.disabled ? this.toDisabledAgent(updated) : this.registerInMemory(updated);
  }

  getAdapter(id: string): AgentAdapter | undefined {
    return this.entries.get(id)?.adapter;
  }

  getStatus(id: string): AgentStatus {
    return this.entries.get(id)?.status ?? "offline";
  }

  setStatus(id: string, status: AgentStatus, error?: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.status === status && entry.error === error) return;
    entry.status = status;
    entry.error = error;
    if (entry.adapter instanceof BaseAdapter) entry.adapter.setRuntimeStatus(status);
    this.broadcastStatus(id);
  }

  subscribeStatusChanges(listener: (status: AgentStatusSnapshot) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  watchConfig(path: string): void {
    this.stopWatchingConfig();
    if (process.env.HOT_RELOAD?.toLowerCase() !== "true") return;
    this.configWatcher = new ConfigWatcher(
      path,
      async (config) => this.reloadConfiguredAgents(config),
      (error) => logger.error({ err: error, path }, "Agent config hot reload failed"),
    );
  }

  stopWatchingConfig(): void {
    this.configWatcher?.destroy();
    this.configWatcher = undefined;
  }

  startHealthChecks(intervalMs = 60_000): void {
    this.stopHealthChecks();
    this.healthCheckTimer = setInterval(() => {
      void this.runHealthChecks();
    }, intervalMs);
    this.healthCheckTimer.unref();
  }

  stopHealthChecks(): void {
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    this.healthCheckTimer = undefined;
  }

  broadcastStatus(id?: string, status?: AgentStatus, error?: string): void {
    if (!id) {
      for (const agentId of this.entries.keys()) this.broadcastStatus(agentId);
      return;
    }
    const entry = this.entries.get(id);
    const snapshot: AgentStatusSnapshot = {
      agentId: id,
      status: status ?? entry?.status ?? "offline",
      error: error ?? entry?.error,
    };
    for (const listener of this.statusListeners) listener(snapshot);
  }

  list(includeDisabled = false): Agent[] {
    const active = [...this.entries.values()].map((entry) => this.toAgent(entry));
    if (!includeDisabled) return active;
    const activeIds = new Set(active.map((agent) => agent.id));
    const disabled = this.persistence
      .loadPersistedAgentMetadata()
      .filter((agent) => agent.disabled && !activeIds.has(agent.id))
      .map((persisted) => this.toDisabledAgent(persisted));
    return [...active, ...disabled];
  }

  getOnlineAgents(): Agent[] {
    return [...this.entries.values()]
      .filter((entry) => entry.status === "online")
      .map((entry) => this.toAgent(entry));
  }

  get(id: string, includeDisabled = false): Agent | undefined {
    const entry = this.entries.get(id);
    if (entry) return this.toAgent(entry);
    if (!includeDisabled) return undefined;
    const persisted = this.persistence.loadPersistedAgentMetadata().find((agent) => agent.id === id);
    return persisted?.disabled ? this.toDisabledAgent(persisted) : undefined;
  }

  async disable(id: string): Promise<Agent | undefined> {
    const persisted = (await this.persistence.loadPersistedAgents()).find((agent) => agent.id === id);
    if (!persisted) return undefined;
    const current = this.entries.get(id);
    current?.adapter.destroy?.();
    this.entries.delete(id);
    this.broadcastStatus(id, "offline");
    const updated = await this.persistence.updatePersistedAgent(id, { disabled: true });
    return updated ? this.toDisabledAgent(updated) : undefined;
  }

  async enable(id: string): Promise<Agent | undefined> {
    const persisted = (await this.persistence.loadPersistedAgents()).find((agent) => agent.id === id);
    if (!persisted) return undefined;
    const updated = await this.persistence.updatePersistedAgent(id, { disabled: false });
    return updated ? this.registerInMemory(updated) : undefined;
  }

  remove(id: string): Promise<boolean> {
    return this.unregisterAndDelete(id);
  }

  async unregisterAndDelete(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    entry?.adapter.destroy?.();
    this.entries.delete(id);
    if (entry) this.broadcastStatus(id, "offline");
    const deleted = await this.persistence.deletePersistedAgent(id);
    if (deleted) {
      this.friends.delete(id);
      for (const friendIds of this.friends.values()) friendIds.delete(id);
    }
    return deleted;
  }

  getCredentialStatus() {
    return this.persistence.getCredentialStatus();
  }

  async clearAllCredentials(): Promise<void> {
    await this.persistence.clearAllCredentials();
    for (const entry of this.entries.values()) {
      delete entry.config.config.apiKey;
      delete entry.persisted.config.apiKey;
      delete entry.adapter.config.apiKey;
    }
  }

  findByDetectionFingerprint(fingerprint: string): Agent | undefined {
    const entry = [...this.entries.values()].find(
      (candidate) => candidate.persisted.detectionFingerprint === fingerprint,
    );
    return entry ? this.toAgent(entry) : undefined;
  }

  private toAgent(entry: RegistryEntry): Agent {
    const row = this.repository.getAgentRow(entry.config.id);
    return {
      id: entry.config.id,
      name: entry.config.name,
      description: entry.config.description ?? "",
      avatar: entry.config.avatar,
      type: entry.config.type,
      status: entry.status,
      model: String(entry.config.config.model ?? ""),
      error: entry.error,
      disabled: false,
      catalogEntryId: entry.persisted.catalogEntryId,
      createdAt: row?.createdAt ?? Date.now(),
      updatedAt: row?.updatedAt ?? Date.now(),
    };
  }

  private toDisabledAgent(persisted: PersistedAgentConfig): Agent {
    const row = this.repository.getAgentRow(persisted.id);
    return {
      id: persisted.id,
      name: persisted.name,
      description: persisted.description ?? "",
      avatar: persisted.avatar,
      type: persisted.type,
      status: "offline",
      model: String(persisted.config.model ?? ""),
      disabled: true,
      catalogEntryId: persisted.catalogEntryId,
      createdAt: row?.createdAt ?? Date.now(),
      updatedAt: row?.updatedAt ?? Date.now(),
    };
  }

  private loadFriends(): void {
    this.friends.clear();
    for (const row of this.repository.listAgentFriends()) {
      this.addFriendInMemory(row.agentId, row.friendId);
      this.addFriendInMemory(row.friendId, row.agentId);
    }
  }

  private addFriendInMemory(agentId: string, friendId: string): void {
    const friendIds = this.friends.get(agentId) ?? new Set<string>();
    friendIds.add(friendId);
    this.friends.set(agentId, friendIds);
  }

  private async reloadConfiguredAgents(config: AppConfig): Promise<void> {
    const nextAgents = new Map(config.agents.map((agent) => [agent.id, agent]));
    for (const agentId of this.configuredAgents.keys()) {
      if (!nextAgents.has(agentId)) await this.unregisterAndDelete(agentId);
    }
    for (const [agentId, next] of nextAgents) {
      const previous = this.configuredAgents.get(agentId);
      if (!previous || !isDeepStrictEqual(previous, next)) {
        await this.registerAndPersist({
          ...next,
          source: "explicit_config",
          managed: false,
          customizedFields: [],
          disabled: false,
        });
      }
    }
    this.configuredAgents.clear();
    for (const [agentId, agent] of nextAgents) this.configuredAgents.set(agentId, agent);
  }

  private async runHealthChecks(): Promise<void> {
    if (this.healthCheckRunning) return;
    this.healthCheckRunning = true;
    try {
      await Promise.all([...this.entries].map(async ([agentId, entry]) => {
        if (entry.status === "busy") return;
        try {
          const healthy = entry.adapter.healthCheck
            ? await entry.adapter.healthCheck()
            : entry.adapter.getStatus() === "online";
          if (!healthy) {
            this.healthCheckFailures.add(agentId);
            this.setStatus(agentId, "error", "Agent health check failed");
          } else if (this.healthCheckFailures.delete(agentId)) {
            this.setStatus(agentId, "online");
          }
        } catch (error) {
          this.healthCheckFailures.add(agentId);
          this.setStatus(agentId, "error", `Agent health check failed: ${messageFromError(error)}`);
        }
      }));
    } finally {
      this.healthCheckRunning = false;
    }
  }
}

function createAdapter(config: AgentConfig): AgentAdapter {
  if (config.type === "openai") {
    return new OpenAIAdapter(config.id, config.name, config.description);
  }
  if (config.type === "cli") {
    return new CliAdapter(config.id, config.name, config.description);
  }
  if (config.type === "custom") {
    return new CustomAdapter(config.id, config.name, config.description);
  }
  if (config.type === "openclaw") {
    return new OpenClawAdapter(config.id, config.name, config.description);
  }
  if (config.type === "dify") {
    return new DifyAdapter(config.id, config.name, config.description);
  }
  if (config.type === "langchain") {
    return new LangChainAdapter(config.id, config.name, config.description);
  }
  return new MockAdapter(config.id, config.name, config.description);
}
