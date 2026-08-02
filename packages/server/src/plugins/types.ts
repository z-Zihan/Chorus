import type { Logger } from "pino";
import type { AgentRegistry } from "../agent/registry.js";
import type { Repository } from "../db/repository.js";
import type { EventHub } from "../ws/events.js";

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  type: "adapter" | "extension";
  entry: string;
  permissions: string[];
}

export interface PluginContext {
  registry: AgentRegistry;
  repository: Repository;
  events: EventHub;
  logger: Logger;
}

export interface PluginInterface {
  init(context: PluginContext): Promise<void>;
  destroy?(): void;
}
