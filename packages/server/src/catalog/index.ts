import type { AgentRegistry } from "../agent/registry.js";
import { defaultCatalog } from "./default-catalog.js";
import type { CatalogEntry, CatalogEntryWithStatus } from "./schema.js";

export class CatalogService {
  constructor(private readonly registry: AgentRegistry) {}

  list(): CatalogEntryWithStatus[] {
    return defaultCatalog.entries.map((entry) => this.withInstalledStatus(entry));
  }

  get(id: string): CatalogEntryWithStatus | undefined {
    const entry = defaultCatalog.entries.find((candidate) => candidate.id === id);
    return entry ? this.withInstalledStatus(entry) : undefined;
  }

  getCompatible(): CatalogEntryWithStatus[] {
    return this.list().filter((entry) => entry.platforms.includes(currentPlatform()));
  }

  private withInstalledStatus(entry: CatalogEntry): CatalogEntryWithStatus {
    const agent = this.registry.list(true).find((candidate) =>
      candidate.catalogEntryId === entry.id ||
      (entry.descriptorId !== undefined && candidate.id === entry.descriptorId),
    );
    return {
      ...entry,
      installed: Boolean(agent),
      agentId: agent?.id,
      disabled: agent?.disabled,
    };
  }
}

function currentPlatform(): "darwin" | "linux" | "win32" {
  if (process.platform === "darwin" || process.platform === "win32") return process.platform;
  return "linux";
}

export * from "./schema.js";
