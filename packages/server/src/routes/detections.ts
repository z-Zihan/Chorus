import type { Agent, CliDetection, PersistedAgentConfig } from "@agentlink/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AgentRegistry } from "../agent/registry.js";
import type { CliDetector } from "../cli-detector/index.js";
import { getCliDescriptor } from "../cli-detector/index.js";

const locateSchema = z.object({
  path: z.string().trim().min(1).max(4_096),
  descriptorId: z.string().trim().min(1).optional(),
});

export function registerDetectionRoutes(
  app: FastifyInstance,
  detector: CliDetector,
  registry: AgentRegistry,
): void {
  app.get("/api/cli/detections", async () => detector.detect());

  app.post("/api/cli/detections/scan", async (request) => {
    const controller = requestAbortController(request);
    return detector.forceRescan(controller.signal);
  });

  app.post<{ Params: { id: string } }>("/api/cli/detections/:id/adopt", async (request, reply) => {
    const detection = detector.find(request.params.id);
    if (!detection) return reply.code(404).send({ error: "CLI_NOT_FOUND" });
    if (detection.status !== "ready" && detection.status !== "installed") {
      return reply.code(409).send({ error: detection.diagnosticsCode ?? "CLI_NOT_READY" });
    }
    const agent = await adoptDetection(detection, registry);
    return reply.code(201).send(agent);
  });

  app.post("/api/cli/detections/locate", async (request, reply) => {
    const parsed = locateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_EXECUTABLE_PATH", issues: parsed.error.flatten() });
    }
    try {
      const controller = requestAbortController(request);
      return await detector.locate(parsed.data.path, parsed.data.descriptorId, controller.signal);
    } catch (error) {
      const code =
        error instanceof Error && error.message === "UNSUPPORTED_CLI"
          ? "UNSUPPORTED_CLI"
          : "CLI_NOT_FOUND";
      return reply.code(code === "UNSUPPORTED_CLI" ? 400 : 404).send({ error: code });
    }
  });
}

export async function adoptDetection(
  detection: CliDetection,
  registry: AgentRegistry,
): Promise<Agent> {
  const existing = registry.findByDetectionFingerprint(detection.fingerprint);
  if (existing) return existing;

  const existingForCommand = await registry.findByResolvedCommandPath(detection.resolvedPath);
  if (existingForCommand) return existingForCommand;

  const descriptor = getCliDescriptor(detection.descriptorId);
  if (!descriptor) throw new Error("UNSUPPORTED_CLI");

  const id = availableAgentId(descriptor.id, registry);
  const config: PersistedAgentConfig = {
    id,
    name: descriptor.displayName,
    description: `${descriptor.displayName} CLI`,
    type: "cli",
    config: {
      command: detection.resolvedPath,
      args: descriptor.adapterTemplate.args,
      input: descriptor.adapterTemplate.input,
      output: descriptor.adapterTemplate.output,
    },
    source: "auto_detected",
    managed: false,
    customizedFields: [],
    detectionFingerprint: detection.fingerprint,
    disabled: false,
  };
  return registry.registerAndPersist(config);
}

function availableAgentId(baseId: string, registry: AgentRegistry): string {
  if (!registry.get(baseId)) return baseId;
  let suffix = 2;
  while (registry.get(`${baseId}-${suffix}`)) suffix += 1;
  return `${baseId}-${suffix}`;
}

function requestAbortController(request: FastifyRequest): AbortController {
  const controller = new AbortController();
  request.raw.once("aborted", () => controller.abort());
  return controller;
}
