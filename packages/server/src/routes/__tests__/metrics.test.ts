import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRegistry } from "../../agent/registry.js";
import type { AgentRuntime } from "../../agent/runtime.js";
import { registerMetricsRoutes } from "../metrics.js";

interface FakeRegistry {
  calls: Array<[string, boolean | undefined]>;
  get(id: string, includeDisabled?: boolean): unknown;
}

interface FakeRuntime {
  calls: Array<string | undefined>;
  getMetrics(agentId?: string): unknown;
}

function createRegistry(
  lookup: (id: string, includeDisabled?: boolean) => unknown = () => undefined,
): FakeRegistry {
  const calls: FakeRegistry["calls"] = [];
  return {
    calls,
    get(id, includeDisabled) {
      calls.push([id, includeDisabled]);
      return lookup(id, includeDisabled);
    },
  };
}

function createRuntime(
  perAgent: (id: string) => unknown = (id) => ({ agentId: id }),
  aggregate: unknown = {},
): FakeRuntime {
  const calls: FakeRuntime["calls"] = [];
  return {
    calls,
    getMetrics(agentId) {
      calls.push(agentId);
      return agentId === undefined ? aggregate : perAgent(agentId);
    },
  };
}

describe("metrics routes", () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function build(registry: FakeRegistry, runtime: FakeRuntime) {
    const app = Fastify({ logger: false });
    apps.push(app);
    registerMetricsRoutes(
      app,
      registry as unknown as AgentRegistry,
      runtime as unknown as AgentRuntime,
    );
    await app.ready();
    return app;
  }

  it("returns per-agent metrics and looks the agent up with includeDisabled=true", async () => {
    const metrics = { totalTasks: 3, successCount: 2, failureCount: 1, avgDurationMs: 120 };
    const registry = createRegistry((id) => ({ id, name: "Agent A" }));
    const runtime = createRuntime(() => metrics);
    const app = await build(registry, runtime);

    const response = await app.inject({ method: "GET", url: "/api/agents/agent-a/metrics" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(metrics);
    expect(registry.calls).toEqual([["agent-a", true]]);
    expect(runtime.calls).toEqual(["agent-a"]);
  });

  it("returns 404 for an unknown agent without querying runtime metrics", async () => {
    const registry = createRegistry();
    const runtime = createRuntime();
    const app = await build(registry, runtime);

    const response = await app.inject({ method: "GET", url: "/api/agents/missing/metrics" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Agent not found" });
    expect(runtime.calls).not.toContain("missing");
  });

  it("serves metrics for a disabled agent visible only with includeDisabled", async () => {
    const registry = createRegistry((id, includeDisabled) =>
      includeDisabled === true ? { id, enabled: false } : undefined,
    );
    const runtime = createRuntime(() => ({ totalTasks: 0 }));
    const app = await build(registry, runtime);

    const response = await app.inject({ method: "GET", url: "/api/agents/disabled/metrics" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ totalTasks: 0 });
  });

  it("returns aggregated metrics for all agents", async () => {
    const aggregate = { "agent-a": { totalTasks: 1 }, "agent-b": { totalTasks: 2 } };
    const registry = createRegistry();
    const runtime = createRuntime(undefined, aggregate);
    const app = await build(registry, runtime);

    const response = await app.inject({ method: "GET", url: "/api/metrics" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(aggregate);
    expect(runtime.calls).toEqual([undefined]);
    expect(registry.calls).toEqual([]);
  });
});
