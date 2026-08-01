import type {
  Agent,
  AgentAdapter,
  AgentConfig,
  AgentStatus,
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
  private readonly persistence: AgentPersistence;

  constructor(private readonly repository: Repository) {
    this.persistence = new AgentPersistence(repository);
  }

  async initialize(configs: AgentConfig[]): Promise<void> {
    for (const config of configs) {
      await this.registerAndPersist({
        ...config,
        source: "explicit_config",
        managed: false,
        customizedFields: [],
        disabled: false,
      });
    }

    for (const persisted of this.persistence.loadPersistedAgents()) {
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
    return this.toAgent(entry);
  }

  async update(
    id: string,
    input: Partial<Pick<AgentConfig, "name" | "description" | "avatar" | "config">>,
  ): Promise<Agent | undefined> {
    const current = this.entries.get(id);
    if (!current) return undefined;
    const config: AgentConfig = {
      ...current.config,
      ...input,
      id,
      config: { ...current.config.config, ...input.config },
    };
    const customizedFields = new Set(current.persisted.customizedFields);
    for (const key of Object.keys(input)) customizedFields.add(key);
    return this.registerAndPersist({
      ...current.persisted,
      ...config,
      customizedFields: [...customizedFields],
    });
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
    entry.status = status;
    entry.error = error;
    if (entry.adapter instanceof BaseAdapter) entry.adapter.setRuntimeStatus(status);
  }

  list(): Agent[] {
    return [...this.entries.values()].map((entry) => this.toAgent(entry));
  }

  get(id: string): Agent | undefined {
    const entry = this.entries.get(id);
    return entry ? this.toAgent(entry) : undefined;
  }

  remove(id: string): boolean {
    return this.unregisterAndDelete(id);
  }

  unregisterAndDelete(id: string): boolean {
    const entry = this.entries.get(id);
    entry?.adapter.destroy?.();
    this.entries.delete(id);
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
