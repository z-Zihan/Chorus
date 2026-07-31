import type { Agent, AgentAdapter, AgentConfig, AgentStatus } from "@agentlink/shared";
import type { Repository } from "../db/repository";
import { BaseAdapter, messageFromError } from "./adapter";
import { MockAdapter } from "./adapters/mock";
import { OpenAIAdapter } from "./adapters/openai";

interface RegistryEntry {
  adapter: AgentAdapter;
  config: AgentConfig;
  status: AgentStatus;
  error?: string;
}

export class AgentRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  constructor(private readonly repository: Repository) {}

  async initialize(configs: AgentConfig[]): Promise<void> {
    for (const config of configs) await this.register(config);
  }

  async register(config: AgentConfig): Promise<Agent> {
    this.entries.get(config.id)?.adapter.destroy?.();
    const adapter = createAdapter(config);
    const entry: RegistryEntry = { adapter, config, status: "offline" };
    this.entries.set(config.id, entry);
    this.repository.upsertAgent(config);
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
    return this.register(config);
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
    const entry = this.entries.get(id);
    entry?.adapter.destroy?.();
    this.entries.delete(id);
    return this.repository.deleteAgent(id);
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
  return new MockAdapter(config.id, config.name, config.description);
}
