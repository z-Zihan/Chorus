import type { Message } from "@agentlink/shared";
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
    const safeTitle = conversation.title.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-|-$/g, "") || "conversation";
    if (parsed.data.format === "json") {
      reply.header("Content-Disposition", `attachment; filename="${safeTitle}.json"`);
      reply.type("application/json; charset=utf-8");
      return { conversation, messages };
    }

    reply.header("Content-Disposition", `attachment; filename="${safeTitle}.md"`);
    reply.type("text/markdown; charset=utf-8");
    return toMarkdown(conversation.title, messages, repository);
  });
}

function toMarkdown(title: string, messages: Message[], repository: Repository): string {
  const sections = messages.map((message) => {
    const author = message.fromType === "user"
      ? "User"
      : repository.getAgentRow(message.fromId)?.name ?? getAgentSnapshotName(message) ?? message.fromId;
    return `## ${author} · ${new Date(message.timestamp).toISOString()}\n\n${message.content}`;
  });
  return [`# ${title}`, ...sections, ""].join("\n\n");
}

function getAgentSnapshotName(message: Message): string | undefined {
  const snapshot = message.metadata?.agentSnapshot;
  if (!snapshot || typeof snapshot !== "object" || !("name" in snapshot)) return undefined;
  return typeof snapshot.name === "string" ? snapshot.name : undefined;
}
