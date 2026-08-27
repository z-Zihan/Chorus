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
import { logger } from "../utils/logger.js";
import type { EventHub } from "../ws/events.js";
import type { TrustStore } from "../hub/trust-store.js";
import { registerTrustRoutes } from "./trust.js";
import type { TokenStore } from "../auth/token-store.js";
import type { AppConfig } from "@chorus/shared";
import type { PluginLoader } from "../plugins/loader.js";
import { registerTokenRoutes } from "./tokens.js";
import { registerStandardRoutes } from "./standards.js";
import type { PairingService } from "../hub/pairing-service.js";

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
  loader?: PluginLoader,
  hub?: HubRouteDependencies,
  trustStore?: TrustStore,
  pairingService?: PairingService,
  tokenStore?: TokenStore,
  auth: AppConfig["auth"] = { enabled: false, tokens: {} },
  events?: EventHub,
): void {
  registerHealthRoutes(app);
  registerSkillRoutes(app);
  registerLogRoutes(app);

  // Global error handler — log all unhandled errors
  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      error instanceof Error && "statusCode" in error
        ? (error as { statusCode: number }).statusCode
        : 500;
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      { method: request.method, url: request.url, statusCode, error: message },
      "Unhandled request error",
    );
    reply.code(statusCode).send({ error: message });
  });
  registerAgentRoutes(app, registry, repository, scheduler);
  registerStandardRoutes(app, registry);
  registerMetricsRoutes(app, registry, runtime);
  registerConversationRoutes(app, repository, registry, runtime, events, scheduler);
  registerCleanupRoutes(app, repository, scheduler);
  registerExportRoutes(app, repository);
  registerSearchRoutes(app, repository.context, repository);
  registerDetectionRoutes(app, detector, registry);
  registerSchedulerRoutes(app, scheduler);
  registerOnboardingRoutes(app, onboarding);
  registerCatalogRoutes(app, catalog, installer);
  if (loader) registerPluginRoutes(app, loader);
  if (hub) registerHubRoutes(app, hub);
  if (trustStore) registerTrustRoutes(app, trustStore, pairingService, hub?.relayClient);
  if (tokenStore) registerTokenRoutes(app, tokenStore, auth);
}
