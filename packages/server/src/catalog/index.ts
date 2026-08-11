import type { CliDetection } from "@chorus/shared";
import type { CliDetector } from "../cli-detector/index.js";
import type { AgentRegistry } from "../agent/registry.js";
import { defaultCatalog } from "./default-catalog.js";
import type { CatalogEntry, CatalogEntryWithStatus } from "./schema.js";

export class CatalogService {
  private detectionCache: { detections: CliDetection[]; ts: number } | null = null;
  private scanning: Promise<void> | null = null;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly detector?: CliDetector,
  ) {}

  async list(): Promise<CatalogEntryWithStatus[]> {
    await this.ensureDetections();
    return defaultCatalog.entries.map((entry) => this.withInstalledStatus(entry));
  }

  async get(id: string): Promise<CatalogEntryWithStatus | undefined> {
    await this.ensureDetections();
    return this.getCached(id);
  }

  getCached(id: string): CatalogEntryWithStatus | undefined {
    const entry = defaultCatalog.entries.find((candidate) => candidate.id === id);
    return entry ? this.withInstalledStatus(entry) : undefined;
  }

  getCompatible(): Promise<CatalogEntryWithStatus[]> {
    return this.list().then((items) => items.filter((entry) => entry.platforms.includes(currentPlatform())));
  }

  private async ensureDetections(): Promise<void> {
    if (!this.detector) return;
    // Use cached detections if available
    const cached = this.detector.getCachedDetections();
    if (cached.length > 0) return;
    // Trigger a scan if no cache
    if (!this.scanning) {
      this.scanning = this.detector.detect().then(() => { this.scanning = null; }).catch(() => { this.scanning = null; });
    }
    await this.scanning;
  }

  private withInstalledStatus(entry: CatalogEntry): CatalogEntryWithStatus {
    const agent = this.registry.list(true).find((candidate) =>
      candidate.catalogEntryId === entry.id ||
      (entry.descriptorId !== undefined && candidate.id === entry.descriptorId),
    );

    let detected = false;
    if (!agent && entry.descriptorId && this.detector) {
      const detections = this.detector.getCachedDetections();
      const detection = detections.find((d) => d.descriptorId === entry.descriptorId);
      detected = Boolean(detection && (detection.status === "ready" || detection.status === "installed"));
    }

    return {
      ...entry,
      installed: Boolean(agent),
      detected,
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
