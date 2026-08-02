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
import { registerSchedulerRoutes } from "./scheduler.js";

export function registerRoutes(
  app: FastifyInstance,
  repository: Repository,
  registry: AgentRegistry,
  runtime: AgentRuntime,
  scheduler: Scheduler,
  detector = new CliDetector(),
  onboarding = new OnboardingService(repository, registry, detector),
  catalog = new CatalogService(registry),
  installer = new InstallExecutor(catalog, registry, detector),
): void {
  registerHealthRoutes(app);
  registerLogRoutes(app);
  registerAgentRoutes(app, registry);
  registerConversationRoutes(app, repository, registry, runtime);
  registerCleanupRoutes(app, repository);
  registerExportRoutes(app, repository);
  registerSearchRoutes(app, repository.context, repository);
  registerDetectionRoutes(app, detector, registry);
  registerSchedulerRoutes(app, scheduler);
  registerOnboardingRoutes(app, onboarding);
  registerCatalogRoutes(app, catalog, installer);
}
