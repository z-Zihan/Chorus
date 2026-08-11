import Fastify from "fastify";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type DatabaseContext } from "../../db/index.js";
import { Repository } from "../../db/repository.js";
import { AgentRegistry } from "../../agent/registry.js";
import { registerAgentRoutes } from "../agents.js";

const databases: DatabaseContext[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.sqlite.close();
});

async function setupApp() {
  const database = createDatabase(":memory:");
  databases.push(database);
  const repository = new Repository(database);
  await repository.getOrCreateLocalUser("Test User");
  repository.upsertAgent(
    {
      id: "local-agent",
      name: "Local Agent",
      description: "",
      type: "mock",
      config: {},
      source: "user",
      managed: false,
      customizedFields: [],
      disabled: false,
      ownerId: "usr_local",
      ownerType: "system",
      capabilities: ["chat", "coding"],
    },
    null,
  );
  repository.upsertRemoteUser({
    id: "usr_remote",
    name: "Remote User",
    hubId: "hub-remote",
    publicKey: "remote-pub-key",
    kind: "remote",
    createdAt: 1000,
    updatedAt: 1000,
    lastSeenAt: 1000,
  });
  repository.upsertAgent(
    {
      id: "remote_agent",
      name: "Remote Agent",
      description: "",
      type: "mock",
      config: {},
      source: "user",
      managed: false,
      customizedFields: [],
      disabled: false,
      ownerId: "usr_remote",
      ownerType: "remote",
      capabilities: ["chat"],
      stale: false,
      homeHubId: "hub-remote",
    },
    null,
  );
  const registry = new AgentRegistry(repository);
  await registry.initialize([]);
  const app = Fastify({ logger: false });
  registerAgentRoutes(app, registry, repository);
  await app.ready();
  return { app, repository };
}

describe("API-01 Owner-aware Discovery", () => {
  it("filters agents by ownerId", async () => {
    const { app } = await setupApp();
    const res = await request(app.server).get("/api/agents?ownerId=usr_local");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("local-agent");
    await app.close();
  });

  it("excludes remote agents with includeRemote=false", async () => {
    const { app } = await setupApp();
    const res = await request(app.server).get("/api/agents?includeRemote=false");
    expect(res.status).toBe(200);
    const ids = res.body.map((a: { id: string }) => a.id);
    expect(ids).toContain("local-agent");
    expect(ids).not.toContain("remote_agent");
    await app.close();
  });

  it("paginates with limit and offset", async () => {
    const { app } = await setupApp();
    const page1 = await request(app.server).get("/api/agents?limit=1&offset=0");
    expect(page1.body).toHaveLength(1);
    const page2 = await request(app.server).get("/api/agents?limit=1&offset=1");
    expect(page2.body).toHaveLength(1);
    expect(page1.body[0].id).not.toBe(page2.body[0].id);
    await app.close();
  });

  it("returns capabilities, stale, and homeHubId", async () => {
    const { app } = await setupApp();
    const res = await request(app.server).get("/api/agents?ownerType=remote");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      id: "remote_agent",
      capabilities: ["chat"],
      stale: false,
      homeHubId: "hub-remote",
      ownerType: "remote",
    });
    await app.close();
  });

  it("returns users with agentCount", async () => {
    const { app } = await setupApp();
    const res = await request(app.server).get("/api/users");
    expect(res.status).toBe(200);
    const local = res.body.find((u: { id: string }) => u.id === "usr_local");
    expect(local.agentCount).toBe(1);
    const remote = res.body.find((u: { id: string }) => u.id === "usr_remote");
    expect(remote.agentCount).toBe(1);
    await app.close();
  });

  it("returns users with agents when includeAgents=true", async () => {
    const { app } = await setupApp();
    const res = await request(app.server).get("/api/users?includeAgents=true");
    expect(res.status).toBe(200);
    const local = res.body.find((u: { id: string }) => u.id === "usr_local");
    expect(local.agents).toHaveLength(1);
    expect(local.agents[0].id).toBe("local-agent");
    await app.close();
  });

  it("GET /api/users/:userId/agents returns user agents", async () => {
    const { app } = await setupApp();
    const res = await request(app.server).get("/api/users/usr_remote/agents");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("remote_agent");
    await app.close();
  });

  it("binds, lists, and unbinds a User Hub", async () => {
    const { app } = await setupApp();
    const bound = await request(app.server)
      .post("/api/users/usr_remote/hubs")
      .send({ hubId: "hub-remote", displayName: "Phone" });
    expect(bound.status).toBe(201);
    expect(bound.body).toMatchObject({ hubId: "hub-remote", displayName: "Phone" });

    const listed = await request(app.server).get("/api/users/usr_remote/hubs");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([
      expect.objectContaining({ hubId: "hub-remote", displayName: "Phone" }),
    ]);

    const unbound = await request(app.server).delete("/api/users/usr_remote/hubs/hub-remote");
    expect(unbound.status).toBe(200);
    expect(unbound.body).toEqual({ ok: true });

    const agents = await request(app.server).get(
      "/api/agents?ownerId=usr_remote&includeDisabled=true",
    );
    expect(agents.body).toEqual([
      expect.objectContaining({ id: "remote_agent", disabled: true, stale: true }),
    ]);
    expect((await request(app.server).get("/api/users/usr_remote/hubs")).body).toEqual([]);
    await app.close();
  });

  it("filters by capability", async () => {
    const { app } = await setupApp();
    const res = await request(app.server).get("/api/agents?capability=coding");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("local-agent");
    await app.close();
  });
});
