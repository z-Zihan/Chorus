import type { FastifyInstance } from "fastify";
import type { AgentRegistry } from "../agent/registry.js";
import type { AgentRuntime } from "../agent/runtime.js";
import type { Repository } from "../db/repository.js";
import { CliDetector } from "../cli-detector/index.js";
import { registerAgentRoutes } from "./agents.js";
import { registerConversationRoutes } from "./conversations.js";
import { registerHealthRoutes } from "./health.js";
import { registerLogRoutes } from "./logs.js";
import { registerDetectionRoutes } from "./detections.js";
import { OnboardingService, registerOnboardingRoutes } from "./onboarding.js";
import { CatalogService } from "../catalog/index.js";
import { InstallExecutor } from "../catalog/installer.js";
import { registerCatalogRoutes } from "./catalog.js";
import { registerCleanupRoutes } from "./cleanup.js";
import { registerExportRoutes } from "./export.js";
import { registerSearchRoutes } from "./search.js";
import type { Scheduler } from "../scheduler/index.js";
import { registerPluginRoutes } from "./plugins.js";
import { registerSchedulerRoutes } from "./scheduler.js";
import { registerMetricsRoutes } from "./metrics.js";
import { registerHubRoutes, type HubRouteDependencies } from "./hub.js";
import { registerSkillRoutes } from "./skill.js";
import type { TrustStore } from "../hub/trust-store.js";
import { registerTrustRoutes } from "./trust.js";

export function registerRoutes(
  app: FastifyInstance,
  repository: Repository,
  registry: AgentRegistry,
  runtime: AgentRuntime,
  scheduler: Scheduler,
  detector = new CliDetector(),
  onboarding = new OnboardingService(repository, registry, detector),
  catalog = new CatalogService(registry, detector),
  installer = new InstallExecutor(catalog, registry, detector),
  loader?: import("../plugins/loader.js").PluginLoader,
  hub?: HubRouteDependencies,
  trustStore?: TrustStore,
): void {
  registerHealthRoutes(app);
  registerSkillRoutes(app);
  registerLogRoutes(app);
  registerAgentRoutes(app, registry, repository);
  registerMetricsRoutes(app, registry, runtime);
  registerConversationRoutes(app, repository, registry, runtime);
  registerCleanupRoutes(app, repository);
  registerExportRoutes(app, repository);
  registerSearchRoutes(app, repository.context, repository);
  registerDetectionRoutes(app, detector, registry);
  registerSchedulerRoutes(app, scheduler);
  registerOnboardingRoutes(app, onboarding);
  registerCatalogRoutes(app, catalog, installer);
  if (loader) registerPluginRoutes(app, loader);
  if (hub) registerHubRoutes(app, hub);
  if (trustStore) registerTrustRoutes(app, trustStore);
}
