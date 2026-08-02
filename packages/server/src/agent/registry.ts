import type {
  Agent,
  AgentAdapter,
  AgentConfig,
  AgentStatus,
  AgentStatusSnapshot,
  PersistedAgentConfig,
} from "@agentlink/shared";
import type { Repository } from "../db/repository.js";
import { BaseAdapter, messageFromError } from "./adapter.js";
import { CliAdapter } from "./adapters/cli.js";
import { MockAdapter } from "./adapters/mock.js";
import { OpenAIAdapter } from "./adapters/openai.js";
import { AgentPersistence } from "./persistence.js";

interface RegistryEntry {
  adapter: AgentAdapter;
  config: AgentConfig;
  persisted: PersistedAgentConfig;
  status: AgentStatus;
  error?: string;
}

export class AgentRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly statusListeners = new Set<(status: AgentStatusSnapshot) => void>();
  private readonly persistence: AgentPersistence;

  constructor(private readonly repository: Repository) {
    this.persistence = new AgentPersistence(repository);
  }

  async initialize(configs: AgentConfig[]): Promise<void> {
    const persistedAgents = this.persistence.loadPersistedAgents();
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

  async register(config: AgentConfig): Promise<Agent> {
    return this.registerAndPersist(config);
  }

  async registerAndPersist(config: AgentConfig | PersistedAgentConfig): Promise<Agent> {
    const persisted = this.persistence.persistAgent(config);
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
      ?? this.persistence.loadPersistedAgents().find((agent) => agent.id === id);
    if (!existing) return undefined;
    const config: AgentConfig = {
      ...existing,
      ...input,
      id,
      config: { ...existing.config, ...input.config },
    };
    const customizedFields = new Set(existing.customizedFields);
    for (const key of Object.keys(input)) customizedFields.add(key);
    const updated = this.persistence.persistAgent({
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
      .loadPersistedAgents()
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
    const persisted = this.persistence.loadPersistedAgents().find((agent) => agent.id === id);
    return persisted?.disabled ? this.toDisabledAgent(persisted) : undefined;
  }

  async disable(id: string): Promise<Agent | undefined> {
    const persisted = this.persistence.loadPersistedAgents().find((agent) => agent.id === id);
    if (!persisted) return undefined;
    const current = this.entries.get(id);
    current?.adapter.destroy?.();
    this.entries.delete(id);
    this.broadcastStatus(id, "offline");
    const updated = this.persistence.updatePersistedAgent(id, { disabled: true });
    return updated ? this.toDisabledAgent(updated) : undefined;
  }

  async enable(id: string): Promise<Agent | undefined> {
    const persisted = this.persistence.loadPersistedAgents().find((agent) => agent.id === id);
    if (!persisted) return undefined;
    const updated = this.persistence.updatePersistedAgent(id, { disabled: false });
    return updated ? this.registerInMemory(updated) : undefined;
  }

  remove(id: string): boolean {
    return this.unregisterAndDelete(id);
  }

  unregisterAndDelete(id: string): boolean {
    const entry = this.entries.get(id);
    entry?.adapter.destroy?.();
    this.entries.delete(id);
    if (entry) this.broadcastStatus(id, "offline");
    return this.persistence.deletePersistedAgent(id);
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
}

function createAdapter(config: AgentConfig): AgentAdapter {
  if (config.type === "openai") {
    return new OpenAIAdapter(config.id, config.name, config.description);
  }
  if (config.type === "cli") {
    return new CliAdapter(config.id, config.name, config.description);
  }
  return new MockAdapter(config.id, config.name, config.description);
}
