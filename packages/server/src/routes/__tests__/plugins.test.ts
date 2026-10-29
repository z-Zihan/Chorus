import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginLoader } from "../../plugins/loader.js";
import type { PluginManifest } from "../../plugins/types.js";
import { registerPluginRoutes } from "../plugins.js";

describe("plugin routes", () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("returns an empty list when no plugin loader is configured", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    registerPluginRoutes(app);
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/api/plugins" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("returns the manifests reported by the loader unchanged", async () => {
    const manifests: PluginManifest[] = [
      {
        name: "adapter-demo",
        version: "1.0.0",
        description: "Demo adapter",
        type: "adapter",
        entry: "index.js",
        permissions: ["agents:read"],
      },
      {
        name: "extension-demo",
        version: "0.2.1",
        description: "Demo extension",
        type: "extension",
        entry: "dist/main.js",
        permissions: [],
      },
    ];
    const loader = { listLoaded: () => manifests };
    const app = Fastify({ logger: false });
    apps.push(app);
    registerPluginRoutes(app, loader as unknown as PluginLoader);
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/api/plugins" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(manifests);
  });
});
