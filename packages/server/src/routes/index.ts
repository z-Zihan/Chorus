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

export function registerRoutes(
  app: FastifyInstance,
  repository: Repository,
  registry: AgentRegistry,
  runtime: AgentRuntime,
  detector = new CliDetector(),
  onboarding = new OnboardingService(repository, registry, detector),
): void {
  registerHealthRoutes(app);
  registerLogRoutes(app);
  registerAgentRoutes(app, registry);
  registerConversationRoutes(app, repository, registry, runtime);
  registerDetectionRoutes(app, detector, registry);
  registerOnboardingRoutes(app, onboarding);
}
