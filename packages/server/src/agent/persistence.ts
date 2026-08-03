import type { AgentConfig, PersistedAgentConfig } from "@agentlink/shared";
import {
  deleteCredential,
  getCredential,
  getCredentialStorageBackend,
  hasCredential,
  setCredential,
  type CredentialStorageBackend,
} from "../credential-store.js";
import type { Repository } from "../db/repository.js";

type AgentChanges = Partial<Omit<PersistedAgentConfig, "id">>;

export interface StoredCredentialStatus {
  id: string;
  name: string;
}

export interface CredentialStatus {
  backend: CredentialStorageBackend;
  agents: StoredCredentialStatus[];
}

export async function persistAgent(
  repository: Repository,
  config: AgentConfig | PersistedAgentConfig,
): Promise<PersistedAgentConfig> {
  const persisted = withDefaults(config);
  const storedConfig = { ...persisted.config };
  const suppliedApiKey = typeof storedConfig.apiKey === "string"
    ? storedConfig.apiKey.trim()
    : undefined;
  delete storedConfig.apiKey;

  const current = repository.getAgentRow(persisted.id);
  let credentialRef = current?.credentialRef ?? null;
  if (suppliedApiKey) {
    await setCredential(persisted.id, suppliedApiKey);
    credentialRef = credentialReference(persisted.id);
  }

  const safePersisted = { ...persisted, config: storedConfig };
  repository.upsertAgent(safePersisted, credentialRef);

  const apiKey = suppliedApiKey ?? (credentialRef ? await getCredential(persisted.id) : null);
  return {
    ...safePersisted,
    config: apiKey === null ? storedConfig : { ...storedConfig, apiKey },
  };
}

export async function loadPersistedAgents(repository: Repository): Promise<PersistedAgentConfig[]> {
  const agents: PersistedAgentConfig[] = [];
  for (const row of repository.listAgentRows()) {
    const stored = rowToPersistedAgent(row);
    const plaintextApiKey = typeof stored.config.apiKey === "string"
      ? stored.config.apiKey.trim()
      : undefined;
    const safeConfig = { ...stored.config };
    delete safeConfig.apiKey;

    let credentialRef = row.credentialRef;
    let apiKey: string | null = null;
    if (plaintextApiKey) {
      await setCredential(row.id, plaintextApiKey);
      credentialRef = credentialReference(row.id);
      apiKey = plaintextApiKey;
      repository.upsertAgent({ ...stored, config: safeConfig }, credentialRef);
    } else if (credentialRef) {
      apiKey = await getCredential(row.id);
    }

    agents.push({
      ...stored,
      config: apiKey === null ? safeConfig : { ...safeConfig, apiKey },
    });
  }
  return agents;
}

export function loadPersistedAgentMetadata(repository: Repository): PersistedAgentConfig[] {
  return repository.listAgentRows().map((row) => {
    const persisted = rowToPersistedAgent(row);
    const config = { ...persisted.config };
    delete config.apiKey;
    return { ...persisted, config };
  });
}

export async function deletePersistedAgent(repository: Repository, id: string): Promise<boolean> {
  await deleteCredential(id);
  return repository.deleteAgent(id);
}

export async function updatePersistedAgent(
  repository: Repository,
  id: string,
  changes: AgentChanges,
): Promise<PersistedAgentConfig | undefined> {
  const current = (await loadPersistedAgents(repository)).find((agent) => agent.id === id);
  if (!current) return undefined;
  return persistAgent(repository, {
    ...current,
    ...changes,
    id,
    config: { ...current.config, ...changes.config },
  });
}

export class AgentPersistence {
  constructor(private readonly repository: Repository) {}

  persistAgent(config: AgentConfig | PersistedAgentConfig): Promise<PersistedAgentConfig> {
    return persistAgent(this.repository, config);
  }

  loadPersistedAgents(): Promise<PersistedAgentConfig[]> {
    return loadPersistedAgents(this.repository);
  }

  loadPersistedAgentMetadata(): PersistedAgentConfig[] {
    return loadPersistedAgentMetadata(this.repository);
  }

  deletePersistedAgent(id: string): Promise<boolean> {
    return deletePersistedAgent(this.repository, id);
  }

  updatePersistedAgent(
    id: string,
    changes: AgentChanges,
  ): Promise<PersistedAgentConfig | undefined> {
    return updatePersistedAgent(this.repository, id, changes);
  }

  async getCredentialStatus(): Promise<CredentialStatus> {
    const agents: StoredCredentialStatus[] = [];
    for (const row of this.repository.listAgentRows()) {
      if (row.credentialRef && await hasCredential(row.id)) {
        agents.push({ id: row.id, name: row.name });
      }
    }
    return { backend: await getCredentialStorageBackend(), agents };
  }

  async clearAllCredentials(): Promise<void> {
    for (const row of this.repository.listAgentRows()) {
      await deleteCredential(row.id);
    }
    this.repository.clearAgentCredentialRefs();
  }
}

function rowToPersistedAgent(
  row: ReturnType<Repository["getAgentRow"]> & {},
): PersistedAgentConfig {
  return {
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
  };
}

function credentialReference(agentId: string): string {
  return `agentlink:${agentId}`;
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
