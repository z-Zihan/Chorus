import { randomUUID } from "node:crypto";
import type { AppConfig, Message, MessageStatus, StreamChunk } from "@agentlink/shared";
import { parseMentions, truncateHistory } from "@agentlink/shared";
import type { Repository } from "../db/repository";
import type { EventHub } from "../ws/events";
import { messageFromError } from "./adapter";
import { A2ABus } from "./a2a-bus";
import type { AgentRegistry } from "./registry";
import { track } from "../analytics";
import { logger } from "../utils/logger";

export class AgentRuntime {
  private readonly controllers = new Map<string, AbortController>();
  private readonly a2aBus: A2ABus;

  constructor(
    private readonly repository: Repository,
    private readonly registry: AgentRegistry,
    private readonly events: EventHub,
    private readonly config: AppConfig,
  ) {
    this.a2aBus = new A2ABus(registry);
  }

  async handleUserMessage(
    conversationId: string,
    rawContent: string,
    explicitMentions: string[] = [],
    explicitAgentId?: string,
  ): Promise<void> {
    const conversation = this.repository.getConversation(conversationId);
    if (!conversation) throw new Error("Conversation not found");
    const content = rawContent.trim();
    if (!content || content.length > 32_000) throw new Error("Message must contain 1–32000 characters");

    const parsed = parseMentions(content);
    const mentions = [...new Set([...explicitMentions, ...parsed.mentionedAgents])];
    if (explicitAgentId && !conversation.agentIds.includes(explicitAgentId)) {
      throw new Error("Agent is not assigned to this conversation");
    }
    const agentId = explicitAgentId
      ?? mentions.find((id) => conversation.agentIds.includes(id))
      ?? conversation.agentIds[0];
    if (!agentId) throw new Error("No Agent is assigned to this conversation");

    const userMessage = createMessage({
      conversationId,
      fromType: "user",
      fromId: "user",
      toType: "agent",
      toId: agentId,
      content,
      status: "done",
    });
    this.repository.saveMessage(userMessage);
    this.events.publish(conversationId, { type: "message", message: userMessage });
    track("message_sent", { conversationId, from: "user", to: agentId });

    const adapter = this.registry.getAdapter(agentId);
    if (!adapter || this.registry.getStatus(agentId) !== "online") {
      const errorMessage = createMessage({
        conversationId,
        fromType: "agent",
        fromId: agentId,
        content: "Agent 当前不可用，请检查配置后重试。",
        status: "error",
      });
      this.repository.saveMessage(errorMessage);
      this.events.publish(conversationId, { type: "message", message: errorMessage });
      logger.warn({ conversationId, agentId }, "Agent unavailable for message");
      track("error", { message: "Agent unavailable", source: "agent_runtime", agentId });
      return;
    }

    const reply = createMessage({
      conversationId,
      fromType: "agent",
      fromId: agentId,
      toType: "user",
      toId: "user",
      content: "",
      status: "thinking",
    });
    this.repository.saveMessage(reply);
    this.events.publish(conversationId, { type: "message", message: reply });
    await this.streamReply(reply, content, mentions, adapter);
  }

  cancel(messageId: string): void {
    this.controllers.get(messageId)?.abort();
  }

  private async streamReply(
    reply: Message,
    content: string,
    mentionedAgents: string[],
    adapter: NonNullable<ReturnType<AgentRegistry["getAdapter"]>>,
  ): Promise<void> {
    const controller = new AbortController();
    const chunks: StreamChunk[] = [];
    let output = "";
    const startedAt = Date.now();
    this.controllers.set(reply.id, controller);
    this.registry.setStatus(adapter.id, "busy");
    logger.info({ agentId: adapter.id, conversationId: reply.conversationId }, "Agent invocation started");
    track("agent_invoke_start", { agentId: adapter.id, conversationId: reply.conversationId });
    this.events.publish(reply.conversationId, {
      type: "typing",
      agentId: adapter.id,
      conversationId: reply.conversationId,
      isTyping: true,
    });

    try {
      const history = truncateHistory(
        this.repository.listMessages(reply.conversationId).filter((item) => item.id !== reply.id),
        this.config.history,
      );
      for await (const chunk of adapter.handleMessage(content, {
        conversationId: reply.conversationId,
        history,
        mentionedAgents,
        a2aBus: this.a2aBus,
        callStack: [adapter.id],
        signal: controller.signal,
      })) {
        chunks.push(chunk);
        if (chunk.type === "text" && !chunk.threadId) output += chunk.content;
        this.events.publish(reply.conversationId, { type: "stream", messageId: reply.id, chunk });
        this.publishA2A(reply.conversationId, adapter.id, content, chunk);
      }
      this.finish(reply, output, "done", chunks, startedAt, adapter.id);
    } catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
      const status: MessageStatus = output ? "partial" : "error";
      const detail = cancelled ? "生成已停止" : messageFromError(error);
      if (!cancelled) {
        logger.error({ err: error, agentId: adapter.id, conversationId: reply.conversationId }, "Agent invocation failed");
        track("error", { message: detail, source: "agent_runtime", agentId: adapter.id });
      }
      const errorChunk: StreamChunk = { type: "error", content: detail };
      chunks.push(errorChunk);
      this.events.publish(reply.conversationId, { type: "stream", messageId: reply.id, chunk: errorChunk });
      this.finish(reply, output || detail, status, chunks, startedAt, adapter.id);
    } finally {
      this.controllers.delete(reply.id);
      this.events.publish(reply.conversationId, {
        type: "typing",
        agentId: adapter.id,
        conversationId: reply.conversationId,
        isTyping: false,
      });
    }
  }

  private finish(
    reply: Message,
    content: string,
    status: MessageStatus,
    chunks: StreamChunk[],
    startedAt: number,
    agentId: string,
  ): void {
    const finalMessage: Message = {
      ...reply,
      content,
      status,
      metadata: { model: this.registry.get(agentId)?.model, durationMs: Date.now() - startedAt, chunks },
    };
    this.repository.updateMessage(reply.id, content, status, finalMessage.metadata);
    this.events.publish(reply.conversationId, { type: "message", message: finalMessage });
    const durationMs = Date.now() - startedAt;
    logger.info({ agentId, conversationId: reply.conversationId, status, durationMs }, "Agent invocation ended");
    track("agent_invoke_end", { agentId, conversationId: reply.conversationId, status, durationMs });
    this.registry.setStatus(agentId, "online");
  }

  private publishA2A(conversationId: string, from: string, request: string, chunk: StreamChunk): void {
    if (!chunk.threadId) return;
    if (chunk.type === "tool_call") {
      this.events.publish(conversationId, {
        type: "a2a_call",
        from,
        to: String(chunk.metadata?.to ?? chunk.sourceAgentId ?? "agent"),
        message: String(chunk.metadata?.request ?? request),
        threadId: chunk.threadId,
      });
      return;
    }
    this.events.publish(conversationId, { type: "a2a_response", threadId: chunk.threadId, chunk });
  }
}

function createMessage(input: Omit<Message, "id" | "timestamp">): Message {
  return { ...input, id: randomUUID(), timestamp: Date.now() };
}
