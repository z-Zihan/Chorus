import type { CliDetection } from "@agentlink/shared";
import {
  descriptorForExecutablePath,
  detect as detectExecutables,
  detectSelectedExecutable,
} from "./detector.js";
import { getCliDescriptor } from "./descriptors.js";

const CACHE_TTL_MS = 30_000;

export class CliDetector {
  private cachedResults: CliDetection[] | null = null;
  private scannedAt = 0;

  async detect(signal?: AbortSignal): Promise<CliDetection[]> {
    if (this.cachedResults && Date.now() - this.scannedAt < CACHE_TTL_MS) {
      return this.cachedResults;
    }
    const detections = await detectExecutables(signal);
    this.cachedResults = detections;
    this.scannedAt = Date.now();
    return detections;
  }

  async forceRescan(signal?: AbortSignal): Promise<CliDetection[]> {
    this.clearCache();
    return this.detect(signal);
  }

  async locate(
    executablePath: string,
    descriptorId?: string,
    signal?: AbortSignal,
  ): Promise<CliDetection> {
    const descriptor = descriptorId
      ? getCliDescriptor(descriptorId)
      : descriptorForExecutablePath(executablePath);
    if (!descriptor) throw new Error("UNSUPPORTED_CLI");
    const detection = await detectSelectedExecutable(executablePath, descriptor, signal);
    const previous = this.cachedResults ?? [];
    this.cachedResults = [
      ...previous.filter((candidate) => candidate.resolvedPath !== detection.resolvedPath),
      detection,
    ];
    this.scannedAt = Date.now();
    return detection;
  }

  getCachedDetections(): CliDetection[] {
    return this.cachedResults ?? [];
  }

  find(id: string): CliDetection | undefined {
    return this.cachedResults?.find(
      (detection) => detection.id === id || detection.fingerprint === id,
    );
  }

  clearCache(): void {
    this.cachedResults = null;
    this.scannedAt = 0;
  }
}

export * from "./descriptors.js";
export * from "./detector.js";
export * from "./path-scanner.js";
export * from "./probe.js";
