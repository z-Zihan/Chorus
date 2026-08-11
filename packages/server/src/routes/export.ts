import type { Message } from "@chorus/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Repository } from "../db/repository.js";

const exportQuerySchema = z.object({ format: z.enum(["markdown", "json"]).default("markdown") });

export function registerExportRoutes(app: FastifyInstance, repository: Repository): void {
  app.get<{ Params: { id: string } }>("/api/conversations/:id/export", async (request, reply) => {
    const parsed = exportQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid export format" });
    const conversation = repository.getConversation(request.params.id);
    if (!conversation) return reply.code(404).send({ error: "Conversation not found" });

    const messages = repository.listAllMessages(conversation.id);
    if (parsed.data.format === "json") {
      reply.header("Content-Disposition", contentDisposition(conversation.title, "json"));
      reply.type("application/json; charset=utf-8");
      return { conversation, messages };
    }

    reply.header("Content-Disposition", contentDisposition(conversation.title, "md"));
    reply.type("text/markdown; charset=utf-8");
    return toMarkdown(conversation.title, messages, repository);
  });
}

function contentDisposition(title: string, extension: "json" | "md"): string {
  const unicodeStem =
    title.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-|-$/g, "") || "conversation";
  const asciiStem =
    unicodeStem
      .normalize("NFKD")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "conversation";
  const unicodeFilename = encodeURIComponent(`${unicodeStem}.${extension}`);
  return `attachment; filename="${asciiStem}.${extension}"; filename*=UTF-8''${unicodeFilename}`;
}

function toMarkdown(title: string, messages: Message[], repository: Repository): string {
  const sections = messages.map((message) => {
    const author =
      message.fromType === "user"
        ? "User"
        : (repository.getAgentRow(message.fromId)?.name ??
          getAgentSnapshotName(message) ??
          message.fromId);
    return `## ${author} · ${new Date(message.timestamp).toISOString()}\n\n${message.content}`;
  });
  return [`# ${title}`, ...sections, ""].join("\n\n");
}

function getAgentSnapshotName(message: Message): string | undefined {
  const snapshot = message.metadata?.agentSnapshot;
  if (!snapshot || typeof snapshot !== "object" || !("name" in snapshot)) return undefined;
  return typeof snapshot.name === "string" ? snapshot.name : undefined;
}
