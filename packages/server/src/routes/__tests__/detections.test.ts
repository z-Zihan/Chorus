import Fastify, { type FastifyInstance } from "fastify";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDetection } from "@chorus/shared";
import { AgentRegistry } from "../../agent/registry";
import { createDatabase } from "../../db";
import { Repository } from "../../db/repository";
import type { CliDetector } from "../../cli-detector/index";
import { registerDetectionRoutes } from "../detections";

function buildDetection(overrides: Partial<CliDetection> = {}): CliDetection {
  return {
    id: "claude-code-detection",
    descriptorId: "claude-code",
    displayName: "Claude Code",
    executablePath: "claude",
    resolvedPath: "/usr/local/bin/claude",
    status: "ready",
    source: "known_dir",
    detectedAt: Date.now(),
    fingerprint: "fingerprint-1",
    ...overrides,
  };
}

describe("detection routes", () => {
  let app: FastifyInstance;
  let registry: AgentRegistry;
  let detector: {
    detect: ReturnType<typeof vi.fn>;
    forceRescan: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    locate: ReturnType<typeof vi.fn>;
  };
  let closeDb: () => void;

  beforeEach(async () => {
    const database = createDatabase(":memory:");
    closeDb = () => database.sqlite.close();
    const repository = new Repository(database);
    await repository.getOrCreateLocalUser("Test User");
    registry = new AgentRegistry(repository);
    await registry.initialize([]);

    detector = {
      detect: vi.fn().mockResolvedValue([]),
      forceRescan: vi.fn().mockResolvedValue([]),
      find: vi.fn().mockReturnValue(undefined),
      locate: vi.fn(),
    };

    app = Fastify({ logger: false });
    registerDetectionRoutes(app, detector as unknown as CliDetector, registry);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    closeDb();
  });

  it("GET /api/cli/detections returns the detector's results", async () => {
    const detections = [buildDetection()];
    detector.detect.mockResolvedValue(detections);

    const response = await request(app.server).get("/api/cli/detections");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(detections);
  });

  it("POST /api/cli/detections/scan triggers a forced rescan", async () => {
    const detections = [buildDetection()];
    detector.forceRescan.mockResolvedValue(detections);

    const response = await request(app.server).post("/api/cli/detections/scan");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(detections);
    expect(detector.forceRescan).toHaveBeenCalledTimes(1);
  });

  it("returns 404 CLI_NOT_FOUND when adopting an unknown detection", async () => {
    const response = await request(app.server).post("/api/cli/detections/missing/adopt");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "CLI_NOT_FOUND" });
  });

  it("returns 409 when adopting a detection that is not ready", async () => {
    detector.find.mockReturnValue(
      buildDetection({ status: "error", diagnosticsCode: "VERSION_PROBE_FAILED" }),
    );

    const response = await request(app.server).post(
      "/api/cli/detections/claude-code-detection/adopt",
    );

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "VERSION_PROBE_FAILED" });
  });

  it("falls back to CLI_NOT_READY when a non-ready detection has no diagnostics code", async () => {
    detector.find.mockReturnValue(
      buildDetection({ status: "needs_auth", diagnosticsCode: undefined }),
    );

    const response = await request(app.server).post(
      "/api/cli/detections/claude-code-detection/adopt",
    );

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "CLI_NOT_READY" });
  });

  it("adopts a ready detection into a new agent", async () => {
    detector.find.mockReturnValue(buildDetection());

    const response = await request(app.server).post(
      "/api/cli/detections/claude-code-detection/adopt",
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: "claude-code",
      name: "Claude Code",
      type: "cli",
    });
    expect(registry.get("claude-code")).toBeDefined();
  });

  it("returns the existing agent when adopting a detection with a known fingerprint", async () => {
    detector.find.mockReturnValue(buildDetection());
    const first = await request(app.server).post("/api/cli/detections/claude-code-detection/adopt");
    expect(first.status).toBe(201);

    const second = await request(app.server).post(
      "/api/cli/detections/claude-code-detection/adopt",
    );

    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
  });

  it("rejects an empty path when locating an executable", async () => {
    const response = await request(app.server).post("/api/cli/detections/locate").send({
      path: "",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("INVALID_EXECUTABLE_PATH");
    expect(detector.locate).not.toHaveBeenCalled();
  });

  it("maps an UNSUPPORTED_CLI locate error to 400", async () => {
    detector.locate.mockRejectedValue(new Error("UNSUPPORTED_CLI"));

    const response = await request(app.server).post("/api/cli/detections/locate").send({
      path: "/usr/local/bin/unknown-cli",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "UNSUPPORTED_CLI" });
  });

  it("maps any other locate error to 404 CLI_NOT_FOUND", async () => {
    detector.locate.mockRejectedValue(new Error("boom"));

    const response = await request(app.server).post("/api/cli/detections/locate").send({
      path: "/usr/local/bin/claude",
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "CLI_NOT_FOUND" });
  });

  it("locates an executable successfully", async () => {
    const detection = buildDetection();
    detector.locate.mockResolvedValue(detection);

    const response = await request(app.server).post("/api/cli/detections/locate").send({
      path: "/usr/local/bin/claude",
      descriptorId: "claude-code",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(detection);
    expect(detector.locate).toHaveBeenCalledWith(
      "/usr/local/bin/claude",
      "claude-code",
      expect.anything(),
    );
  });
});
