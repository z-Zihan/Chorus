import type { AgentConfig, PersistedAgentConfig } from "@agentlink/shared";
import type { Repository } from "../db/repository.js";

type AgentChanges = Partial<Omit<PersistedAgentConfig, "id">>;

export function persistAgent(
  repository: Repository,
  config: AgentConfig | PersistedAgentConfig,
): PersistedAgentConfig {
  const persisted = withDefaults(config);
  repository.upsertAgent(persisted);
  return persisted;
}

export function loadPersistedAgents(repository: Repository): PersistedAgentConfig[] {
  return repository.listAgentRows().map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    avatar: row.avatar ?? undefined,
    type: row.type as AgentConfig["type"],
    config: safeJson<Record<string, unknown>>(row.config, {}),
    source: row.source as PersistedAgentConfig["source"],
    managed: row.managed,
    customizedFields: safeJson<string[]>(row.customizedFields, []),
    catalogEntryId: row.catalogEntryId ?? undefined,
    detectionFingerprint: row.detectionFingerprint ?? undefined,
    disabled: row.disabled,
  }));
}

export function deletePersistedAgent(repository: Repository, id: string): boolean {
  return repository.deleteAgent(id);
}

export function updatePersistedAgent(
  repository: Repository,
  id: string,
  changes: AgentChanges,
): PersistedAgentConfig | undefined {
  const current = loadPersistedAgents(repository).find((agent) => agent.id === id);
  if (!current) return undefined;
  const updated: PersistedAgentConfig = {
    ...current,
    ...changes,
    id,
    config: { ...current.config, ...changes.config },
  };
  repository.upsertAgent(updated);
  return updated;
}

export class AgentPersistence {
  constructor(private readonly repository: Repository) {}

  persistAgent(config: AgentConfig | PersistedAgentConfig): PersistedAgentConfig {
    return persistAgent(this.repository, config);
  }

  loadPersistedAgents(): PersistedAgentConfig[] {
    return loadPersistedAgents(this.repository);
  }

  deletePersistedAgent(id: string): boolean {
    return deletePersistedAgent(this.repository, id);
  }

  updatePersistedAgent(id: string, changes: AgentChanges): PersistedAgentConfig | undefined {
    return updatePersistedAgent(this.repository, id, changes);
  }
}

function withDefaults(config: AgentConfig | PersistedAgentConfig): PersistedAgentConfig {
  const persisted = config as Partial<PersistedAgentConfig>;
  return {
    ...config,
    source: persisted.source ?? "user",
    managed: persisted.managed ?? false,
    customizedFields: persisted.customizedFields ?? [],
    catalogEntryId: persisted.catalogEntryId,
    detectionFingerprint: persisted.detectionFingerprint,
    disabled: persisted.disabled ?? false,
  };
}

function safeJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
