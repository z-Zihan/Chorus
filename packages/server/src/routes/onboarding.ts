import { randomUUID } from "node:crypto";
import type { OnboardingStatus } from "@agentlink/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AgentRegistry } from "../agent/registry.js";
import type { CliDetector } from "../cli-detector/index.js";
import type { Repository } from "../db/repository.js";
import { adoptDetection } from "./detections.js";

const ONBOARDING_SETTING_KEY = "onboarding.state.v1";
const selectAgentSchema = z.object({ detectionId: z.string().trim().min(1) });

export class OnboardingService {
  private state: OnboardingStatus;

  constructor(
    private readonly repository: Repository,
    private readonly registry: AgentRegistry,
    private readonly detector: CliDetector,
  ) {
    this.state = this.restoreState();
  }

  getStatus(): OnboardingStatus {
    return this.state;
  }

  async bootstrap(): Promise<OnboardingStatus> {
    if (this.state.step === "completed" && this.registry.list().length > 0) return this.state;
    const readyAgent = this.registry.list().find((agent) => agent.status === "online");
    if (readyAgent) {
      const conversation = this.repository.ensureDefaultConversation(readyAgent.id);
      return this.setState({
        step: "completed",
        detections: this.detector.getCachedDetections(),
        agentId: readyAgent.id,
        conversationId: conversation.id,
      });
    }
    return this.rescan();
  }

  async rescan(): Promise<OnboardingStatus> {
    this.setState({ step: "scanning", scanId: randomUUID(), detections: [] });
    try {
      const detections = await this.detector.forceRescan();
      const ready = detections.filter((detection) => detection.status === "ready");
      if (ready.length === 1 && ready[0]) {
        return this.createWorkspace(ready[0].id);
      }
      if (ready.length > 1) {
        return this.setState({ step: "choose_agent", detections });
      }
      const authDetection = detections.find(
        (detection) => detection.status === "needs_auth" || detection.status === "installed",
      );
      if (authDetection) {
        return this.setState({ step: "needs_auth", detections, detection: authDetection });
      }
      if (detections.length === 0) return this.setState({ step: "none_found", detections: [] });
      return this.setState({
        step: "error",
        detections,
        code: detections[0]?.diagnosticsCode ?? "CLI_SCAN_FAILED",
        recoverable: true,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return this.state;
      return this.setState({
        step: "error",
        detections: [],
        code: "CLI_SCAN_FAILED",
        recoverable: true,
      });
    }
  }

  async selectAgent(detectionId: string): Promise<OnboardingStatus> {
    return this.createWorkspace(detectionId);
  }

  complete(): OnboardingStatus {
    const conversation = this.state.conversationId ?? this.repository.listConversations()[0]?.id;
    return this.setState({
      step: "completed",
      detections: this.state.detections,
      agentId: this.state.agentId,
      conversationId: conversation,
    });
  }

  reset(): OnboardingStatus {
    return this.setState({ step: "bootstrapping", detections: [] });
  }

  private async createWorkspace(detectionId: string): Promise<OnboardingStatus> {
    const detection = this.detector.find(detectionId);
    if (!detection) {
      return this.setState({
        step: "error",
        detections: this.detector.getCachedDetections(),
        code: "CLI_NOT_FOUND",
        recoverable: true,
      });
    }
    if (detection.status !== "ready") {
      return this.setState({ step: "needs_auth", detections: this.state.detections, detection });
    }

    this.setState({
      step: "creating_workspace",
      detections: this.state.detections.length
        ? this.state.detections
        : this.detector.getCachedDetections(),
    });
    try {
      const agent = await adoptDetection(detection, this.registry);
      if (agent.status !== "online") throw new Error("ADAPTER_INIT_FAILED");
      const conversation = this.repository.ensureDefaultConversation(agent.id);
      return this.setState({
        step: "completed",
        detections: this.detector.getCachedDetections(),
        agentId: agent.id,
        conversationId: conversation.id,
      });
    } catch (error) {
      return this.setState({
        step: "error",
        detections: this.detector.getCachedDetections(),
        code: error instanceof Error ? error.message : "ADAPTER_INIT_FAILED",
        recoverable: true,
      });
    }
  }

  private restoreState(): OnboardingStatus {
    const value = this.repository.getSetting(ONBOARDING_SETTING_KEY);
    if (!value) return { step: "bootstrapping", detections: [] };
    try {
      return JSON.parse(value) as OnboardingStatus;
    } catch {
      return { step: "bootstrapping", detections: [] };
    }
  }

  private setState(state: OnboardingStatus): OnboardingStatus {
    this.state = state;
    this.repository.setSetting(ONBOARDING_SETTING_KEY, JSON.stringify(state));
    return state;
  }
}

export function registerOnboardingRoutes(
  app: FastifyInstance,
  onboarding: OnboardingService,
): void {
  app.get("/api/onboarding/status", async () => onboarding.getStatus());
  app.post("/api/onboarding/rescan", async () => onboarding.rescan());
  app.post("/api/onboarding/select-agent", async (request, reply) => {
    const parsed = selectAgentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_DETECTION" });
    const state = await onboarding.selectAgent(parsed.data.detectionId);
    return reply.code(state.step === "error" ? 409 : 200).send(state);
  });
  app.post("/api/onboarding/complete", async () => onboarding.complete());
  app.post("/api/onboarding/reset", async () => onboarding.reset());
}
