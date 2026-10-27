import type { FastifyInstance } from "fastify";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Message } from "@chorus/shared";
import type { Repository } from "../../db/repository";
import { buildTestContext } from "./test-app";

describe("export routes", () => {
  let app: FastifyInstance;
  let repository: Repository;

  beforeEach(async () => {
    const context = await buildTestContext();
    app = context.app;
    repository = context.repository;
  });

  afterEach(async () => {
    await app.close();
  });

  async function createConversation(title: string): Promise<string> {
    const response = await request(app.server)
      .post("/api/conversations")
      .send({ title, agentId: "test-agent" });
    return response.body.id as string;
  }

  it("404s for a conversation that does not exist", async () => {
    const response = await request(app.server).get("/api/conversations/does-not-exist/export");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Conversation not found" });
  });

  it("rejects an unsupported export format", async () => {
    const id = await createConversation("Formats");

    const response = await request(app.server).get(`/api/conversations/${id}/export?format=xml`);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid export format" });
  });

  it("exports markdown by default with the expected headers and structure", async () => {
    const id = await createConversation("Export Me");
    await request(app.server).post(`/api/conversations/${id}/messages`).send({ content: "hi" });

    const response = await request(app.server).get(`/api/conversations/${id}/export`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/markdown");
    expect(response.headers["content-disposition"]).toContain("attachment");
    expect(response.headers["content-disposition"]).toContain('filename="Export-Me.md"');
    expect(response.text.startsWith("# Export Me")).toBe(true);
    expect(response.text).toMatch(/## User · \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\n\nhi/);
  });

  it("exports as json when format=json is requested", async () => {
    const id = await createConversation("JSON Export");
    await request(app.server).post(`/api/conversations/${id}/messages`).send({ content: "hi" });

    const response = await request(app.server).get(`/api/conversations/${id}/export?format=json`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["content-disposition"]).toContain('filename="JSON-Export.json"');
    expect(response.body.conversation).toMatchObject({ id, title: "JSON Export" });
    expect(response.body.messages).toEqual(expect.any(Array));
    expect(response.body.messages.length).toBeGreaterThan(0);
  });

  it("encodes a unicode/emoji title with both an ascii fallback and a UTF-8 filename*", async () => {
    const title = "测试 🎉 Report";
    const id = await createConversation(title);

    const response = await request(app.server).get(`/api/conversations/${id}/export`);

    expect(response.status).toBe(200);
    const expected = `attachment; filename="Report.md"; filename*=UTF-8''${encodeURIComponent(
      "测试-Report.md",
    )}`;
    expect(response.headers["content-disposition"]).toBe(expected);
  });

  it("resolves the markdown author from the live agent row", async () => {
    const id = await createConversation("Author resolution");
    await request(app.server).post(`/api/conversations/${id}/messages`).send({ content: "hi" });

    const response = await request(app.server).get(`/api/conversations/${id}/export`);

    expect(response.text).toContain("## Test Agent · ");
  });

  it("falls back to the embedded agent snapshot once the agent is deleted", async () => {
    const id = await createConversation("Snapshot fallback");
    await request(app.server).post(`/api/conversations/${id}/messages`).send({ content: "hi" });

    const deleted = await request(app.server).delete("/api/agents/test-agent");
    expect(deleted.status).toBe(200);
    expect(deleted.body.ok).toBe(true);

    const response = await request(app.server).get(`/api/conversations/${id}/export`);

    expect(response.text).toContain("## Test Agent · ");
  });

  it("falls back to the raw fromId when there is no agent row or snapshot", async () => {
    const id = await createConversation("Orphaned author");
    const ghostMessage: Message = {
      id: "ghost-message",
      conversationId: id,
      fromType: "agent",
      fromId: "ghost-agent",
      content: "nobody knows me",
      timestamp: Date.now(),
      status: "done",
    };
    repository.saveMessage(ghostMessage);

    const response = await request(app.server).get(`/api/conversations/${id}/export`);

    expect(response.text).toContain("## ghost-agent · ");
  });
});
