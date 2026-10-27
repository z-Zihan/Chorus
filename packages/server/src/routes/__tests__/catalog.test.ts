import Fastify, { type FastifyInstance } from "fastify";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogService } from "../../catalog/index";
import type { InstallExecutor } from "../../catalog/installer";
import { registerCatalogRoutes } from "../catalog";

describe("catalog routes", () => {
  let app: FastifyInstance;
  let catalog: { list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  let installer: {
    install: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    catalog = {
      list: vi.fn().mockResolvedValue([{ id: "claude-code", name: "Claude Code" }]),
      get: vi.fn().mockResolvedValue(undefined),
    };
    installer = {
      install: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
      cancel: vi.fn().mockReturnValue(undefined),
    };

    app = Fastify({ logger: false });
    registerCatalogRoutes(
      app,
      catalog as unknown as CatalogService,
      installer as unknown as InstallExecutor,
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /api/catalog returns the catalog list", async () => {
    const response = await request(app.server).get("/api/catalog");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: "claude-code", name: "Claude Code" }]);
    expect(catalog.list).toHaveBeenCalledTimes(1);
  });

  it("GET /api/catalog/:id returns 404 for an unknown entry", async () => {
    const response = await request(app.server).get("/api/catalog/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "CATALOG_ENTRY_NOT_FOUND" });
  });

  it("GET /api/catalog/:id returns the entry when found", async () => {
    catalog.get.mockResolvedValue({ id: "claude-code", name: "Claude Code", installed: false });

    const response = await request(app.server).get("/api/catalog/claude-code");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: "claude-code", name: "Claude Code", installed: false });
  });

  it("rejects an install body with an invalid recipeMethod", async () => {
    const response = await request(app.server)
      .post("/api/catalog/claude-code/install")
      .send({ recipeMethod: "not-a-real-method" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("INVALID_INSTALL_OPTIONS");
    expect(installer.install).not.toHaveBeenCalled();
  });

  it("trims whitespace off the apiKey before installing", async () => {
    installer.install.mockReturnValue({
      id: "install-1",
      entryId: "openai-api",
      stage: "checking",
      progress: 5,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });

    const response = await request(app.server)
      .post("/api/catalog/openai-api/install")
      .send({ apiKey: "  sk-test-key  ", acceptPermissions: true });

    expect(response.status).toBe(202);
    expect(installer.install).toHaveBeenCalledWith(
      "openai-api",
      expect.objectContaining({ apiKey: "sk-test-key" }),
    );
  });

  it("omits apiKey from the options when not provided", async () => {
    installer.install.mockReturnValue({
      id: "install-2",
      entryId: "claude-code",
      stage: "checking",
      progress: 5,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });

    await request(app.server).post("/api/catalog/claude-code/install").send({});

    expect(installer.install).toHaveBeenCalledWith(
      "claude-code",
      expect.not.objectContaining({
        apiKey: expect.anything(),
      }),
    );
  });

  it("maps a CATALOG_ENTRY_NOT_FOUND install error to 404", async () => {
    installer.install.mockImplementation(() => {
      throw new Error("CATALOG_ENTRY_NOT_FOUND");
    });

    const response = await request(app.server).post("/api/catalog/missing/install").send({});

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "CATALOG_ENTRY_NOT_FOUND" });
  });

  it("maps any other install error to 400", async () => {
    installer.install.mockImplementation(() => {
      throw new Error("PERMISSIONS_NOT_ACCEPTED");
    });

    const response = await request(app.server).post("/api/catalog/claude-code/install").send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "PERMISSIONS_NOT_ACCEPTED" });
  });

  it("returns 202 with the installer's status on success", async () => {
    const status = {
      id: "install-3",
      entryId: "claude-code",
      stage: "checking",
      progress: 5,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    installer.install.mockReturnValue(status);

    const response = await request(app.server).post("/api/catalog/claude-code/install").send({});

    expect(response.status).toBe(202);
    expect(response.body).toEqual(status);
  });

  it("GET /api/installations/:id returns 404 when not found", async () => {
    const response = await request(app.server).get("/api/installations/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "INSTALLATION_NOT_FOUND" });
  });

  it("GET /api/installations/:id returns the installation when found", async () => {
    const status = {
      id: "install-4",
      entryId: "claude-code",
      stage: "downloading",
      progress: 25,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    installer.get.mockReturnValue(status);

    const response = await request(app.server).get("/api/installations/install-4");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(status);
  });

  it("POST /api/installations/:id/cancel returns 404 when not found", async () => {
    const response = await request(app.server).post("/api/installations/does-not-exist/cancel");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "INSTALLATION_NOT_FOUND" });
  });

  it("POST /api/installations/:id/cancel returns the cancelled installation", async () => {
    const status = {
      id: "install-5",
      entryId: "claude-code",
      stage: "error",
      progress: 25,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      cancelled: true,
      error: "INSTALLATION_CANCELLED",
    };
    installer.cancel.mockReturnValue(status);

    const response = await request(app.server).post("/api/installations/install-5/cancel");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(status);
    expect(installer.cancel).toHaveBeenCalledWith("install-5");
  });
});
