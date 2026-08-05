import type { P2PDiscoveredHub } from "@agentlink/shared";
import Bonjour, { type Browser, type Service } from "bonjour-service";
import { logger } from "../utils/logger.js";

type DiscoveredListener = (hub: P2PDiscoveredHub) => void;

export class P2PDiscovery {
  private bonjour?: Bonjour;
  private browser?: Browser;
  private service?: Service;
  private localHubId?: string;
  private readonly services = new Map<string, P2PDiscoveredHub>();
  private readonly listeners = new Set<DiscoveredListener>();

  start(hubId: string, publicKey: string, displayName: string, port: number): void {
    if (this.bonjour) return;
    this.localHubId = hubId;
    this.bonjour = new Bonjour();
    this.service = this.bonjour.publish({
      name: `agentlink-${hubId.slice(0, 8)}`,
      type: "agentlink",
      port,
      txt: { hubId, publicKey, displayName, version: "1.0" },
    });
    this.browser = this.bonjour.find({ type: "agentlink" });
    this.browser.on("up", (service) => this.handleService(service));
    this.browser.on("down", (service) => {
      const hubId = stringValue(service.txt?.hubId);
      if (hubId) this.services.delete(hubId);
    });
  }

  discover(): P2PDiscoveredHub[] {
    return [...this.services.values()];
  }

  onDiscovered(callback: DiscoveredListener): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  stop(): void {
    this.browser?.stop();
    this.service?.stop();
    this.bonjour?.destroy();
    this.browser = undefined;
    this.service = undefined;
    this.bonjour = undefined;
    this.services.clear();
  }

  private handleService(service: Service): void {
    const txt = txtRecord(service.txt);
    const hubId = txt.hubId;
    const publicKey = txt.publicKey;
    if (!hubId || !publicKey || hubId === this.localHubId || !Number.isInteger(service.port)) return;
    const host = service.addresses?.find((address) => address.includes("."))
      ?? service.addresses?.[0]
      ?? service.host;
    if (!host) return;
    const discovered: P2PDiscoveredHub = {
      hubId,
      publicKey,
      displayName: txt.displayName || hubId.slice(0, 8),
      host,
      port: service.port,
      txt,
    };
    const existing = this.services.get(hubId);
    this.services.set(hubId, discovered);
    if (existing) return;
    logger.info({ hubId, host, port: service.port }, "Discovered P2P Hub");
    for (const listener of this.listeners) listener(discovered);
  }
}

function txtRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    const string = stringValue(item);
    if (string !== undefined) result[key] = string;
  }
  return result;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}
