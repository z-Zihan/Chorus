import { randomUUID } from "node:crypto";
import type { AppConfig, Message, MessageStatus, StreamChunk } from "@agentlink/shared";
import { parseMentions, truncateHistory } from "@agentlink/shared";
import type { Repository } from "../db/repository";
import type { EventHub } from "../ws/events";
import { messageFromError } from "./adapter";
import { A2ABus, type A2AAuthorizationRequest, type A2AAuthorizationResult } from "./a2a-bus";
import { AdapterMetrics, type AgentMetrics } from "./metrics";
import { A2APermissions, type A2APermissionMode } from "./permissions";
import type { AgentRegistry } from "./registry";
import { track } from "../analytics";
import { logger } from "../utils/logger";
import type { HubMessageRouter } from "../hub/message-router";
import type { RelayClient } from "../hub/relay-client";

export class AgentRuntime {
  private readonly controllers = new Map<string, AbortController>();
  private readonly a2aResults = new Map<string, string>();
  private readonly pendingA2AConfirmations = new Map<
    string,
    {
      resolve: (result: A2AAuthorizationResult) => void;
      timeout: ReturnType<typeof setTimeout>;
      signal?: AbortSignal;
      abort?: () => void;
    }
  >();
  private readonly a2aBus: A2ABus;
  private readonly a2aPermissions: A2APermissions;
  private readonly metrics = new AdapterMetrics();

  constructor(
    private readonly repository: Repository,
    private readonly registry: AgentRegistry,
    private readonly events: EventHub,
    private readonly config: AppConfig,
    relayClient?: RelayClient,
  ) {
    this.a2aPermissions = new A2APermissions(repository);
    this.a2aBus = new A2ABus(registry, undefined, relayClient, (request) =>
      this.authorizeA2A(request),
    );
  }

  getA2APermission(conversationId: string): A2APermissionMode {
    return this.a2aPermissions.getPermission(conversationId);
  }

  setA2APermission(conversationId: string, mode: A2APermissionMode): void {
    this.a2aPermissions.setPermission(conversationId, mode);
  }

  confirmA2A(threadId: string, approved: boolean): boolean {
    const pending = this.pendingA2AConfirmations.get(threadId);
    if (!pending) return false;
    this.clearPendingA2AConfirmation(threadId, pending);
    pending.resolve({
      approved,
      error: approved ? undefined : "A2A 调用未获批准",
    });
    return true;
  }

  setHubMessageRouter(router: HubMessageRouter): void {
    this.a2aBus.setHubMessageRouter(router);
  }

  async handleRemoteA2ACall(
    fromAgentId: string,
    toAgentId: string,
    message: string,
    context: Parameters<A2ABus["call"]>[3],
  ): Promise<string> {
    let output = "";
    for await (const chunk of this.a2aBus.call(fromAgentId, toAgentId, message, context)) {
      if (["text", "task_step", "error"].includes(chunk.type)) output += chunk.content;
    }
    return output;
  }

  async handleHubMessage(
    conversationId: string,
    content: string,
    targetAgentId?: string,
  ): Promise<string> {
    const previousIds = new Set(
      this.repository.listMessages(conversationId).map((message) => message.id),
    );
    await this.handleUserMessage(conversationId, content, [], targetAgentId);
    return this.repository
      .listMessages(conversationId)
      .filter((message) => !previousIds.has(message.id) && message.fromType === "agent")
      .map((message) => message.content)
      .filter(Boolean)
      .join("\n");
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
    if (!content || content.length > 32_000)
      throw new Error("Message must contain 1–32000 characters");

    const parsed = parseMentions(content, conversation.agentIds);
    const mentionedByName = parsed.mentionedAgentNames.flatMap((name) =>
      conversation.agentIds.filter((id) => {
        const agent = this.registry.get(id);
        return agent ? mentionKey(agent.name) === mentionKey(name) : false;
      }),
    );
    const mentions = [
      ...new Set([...explicitMentions, ...parsed.mentionedAgents, ...mentionedByName]),
    ].filter((id) => conversation.agentIds.includes(id));
    if (explicitAgentId && !conversation.agentIds.includes(explicitAgentId)) {
      throw new Error("Agent is not assigned to this conversation");
    }
    const routingMentions = [
      ...new Set([...mentions, ...(explicitAgentId ? [explicitAgentId] : [])]),
    ];
    const firstOnlineAgentId = conversation.agentIds.find(
      (agentId) => this.registry.getStatus(agentId) === "online",
    );
    const targetAgentIds =
      conversation.type === "group"
        ? routingMentions.length > 0
          ? routingMentions.filter((agentId) => this.registry.getStatus(agentId) === "online")
          : firstOnlineAgentId
            ? [firstOnlineAgentId]
            : []
        : [explicitAgentId ?? routingMentions[0] ?? conversation.agentIds[0]].filter(
            (agentId): agentId is string => Boolean(agentId),
          );
    if (conversation.type !== "group" && targetAgentIds.length === 0) {
      throw new Error("No Agent is assigned to this conversation");
    }

    const userMessage = createMessage({
      conversationId,
      fromType: "user",
      fromId: "user",
      toType: "agent",
      toId: targetAgentIds.length === 1 ? targetAgentIds[0] : undefined,
      content,
      status: "done",
    });
    this.repository.saveMessage(userMessage);
    this.events.publish(conversationId, { type: "message", message: userMessage });
    track("message_sent", {
      conversationId,
      from: "user",
      to: targetAgentIds.length === 1 ? (targetAgentIds[0] ?? "all") : "all",
    });

    await Promise.all(
      targetAgentIds.map((agentId) =>
        this.routeMessageToAgent(conversationId, agentId, content, mentions),
      ),
    );
  }

  private async routeMessageToAgent(
    conversationId: string,
    agentId: string,
    content: string,
    mentionedAgents: string[],
  ): Promise<void> {
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
    await this.streamReply(reply, content, mentionedAgents, adapter);
  }

  cancel(messageId: string): void {
    const controller = this.controllers.get(messageId);
    if (controller) controller.abort();
    else this.a2aBus.cancel(messageId);
  }

  getMetrics(): Record<string, AgentMetrics>;
  getMetrics(agentId: string): AgentMetrics;
  getMetrics(agentId?: string): AgentMetrics | Record<string, AgentMetrics> {
    return agentId ? this.metrics.getMetrics(agentId) : this.metrics.getAllMetrics();
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
    logger.info(
      { agentId: adapter.id, conversationId: reply.conversationId },
      "Agent invocation started",
    );
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
      const conversation = this.repository.getConversation(reply.conversationId);
      const availableAgentIds = conversation?.agentIds ?? [adapter.id];
      const otherAgentIds = availableAgentIds.filter((id) => id !== adapter.id);
      let augmentedContent = content;
      if (conversation?.type === "group" && otherAgentIds.length > 0) {
        const contentLower = content.toLowerCase();
        const mentionedAgents = otherAgentIds
          .map((id) => {
            const agent = this.registry.get(id);
            return { id, name: agent?.name ?? id };
          })
          .filter(
            ({ id, name }) =>
              contentLower.includes(`@${name.toLowerCase()}`) ||
              contentLower.includes(`@${id.toLowerCase()}`),
          );

        if (mentionedAgents.length > 0) {
          const request = mentionedAgents
            .map(({ name }) => `@${name}`)
            .reduce((msg, mention) => msg.replace(mention, ""), content)
            .replace(/@\S+/giu, "")
            .trim();
          const a2aInstructions = mentionedAgents
            .map(({ id }) => `[A2A_CALL: ${id}: ${request}]`)
            .join("\n");
          augmentedContent = `${content}\n\n--- System: The user mentioned ${mentionedAgents.map(({ name }) => name).join(", ")}. If you need help from them, use:\n${a2aInstructions}`;
        }
      }
      for await (const chunk of adapter.handleMessage(augmentedContent, {
        conversationId: reply.conversationId,
        history,
        mentionedAgents,
        availableAgentIds,
        a2aBus: this.a2aBus,
        callStack: [adapter.id],
        parentMessageId: reply.id,
        signal: controller.signal,
      })) {
        chunks.push(chunk);
        if (chunk.type === "text" && !chunk.threadId) output += chunk.content;
        this.events.publish(reply.conversationId, { type: "stream", messageId: reply.id, chunk });
        this.publishA2A(reply.conversationId, reply.id, adapter.id, content, chunk);
      }
      this.finish(reply, output, "done", chunks, startedAt, adapter.id);
      this.metrics.recordInvocation(adapter.id, Date.now() - startedAt, true);
    } catch (error) {
      const cancelled =
        controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
      const status: MessageStatus = output ? "partial" : "error";
      const detail = cancelled ? "生成已停止" : messageFromError(error);
      if (!cancelled) {
        logger.error(
          {
            err: error,
            agentId: adapter.id,
            conversationId: reply.conversationId,
            errorMessage: detail,
          },
          "Agent invocation failed",
        );
        track("error", { message: detail, source: "agent_runtime", agentId: adapter.id });
      } else {
        logger.warn(
          { agentId: adapter.id, conversationId: reply.conversationId, reason: "cancelled" },
          "Agent invocation cancelled",
        );
      }
      const errorChunk: StreamChunk = { type: "error", content: detail };
      chunks.push(errorChunk);
      this.events.publish(reply.conversationId, {
        type: "stream",
        messageId: reply.id,
        chunk: errorChunk,
      });
      this.finish(reply, output || detail, status, chunks, startedAt, adapter.id);
      this.metrics.recordInvocation(adapter.id, Date.now() - startedAt, false);
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
      metadata: {
        model: this.registry.get(agentId)?.model,
        durationMs: Date.now() - startedAt,
        chunks,
      },
    };
    this.repository.updateMessage(reply.id, content, status, finalMessage.metadata);
    this.events.publish(reply.conversationId, { type: "message", message: finalMessage });
    const durationMs = Date.now() - startedAt;
    logger.info(
      { agentId, conversationId: reply.conversationId, status, durationMs },
      "Agent invocation ended",
    );
    track("agent_invoke_end", {
      agentId,
      conversationId: reply.conversationId,
      status,
      durationMs,
    });
    this.registry.setStatus(agentId, "online");
  }

  private publishA2A(
    conversationId: string,
    parentMessageId: string,
    from: string,
    request: string,
    chunk: StreamChunk,
  ): void {
    if (!chunk.threadId) return;
    if (chunk.type === "tool_call") {
      const to = String(chunk.metadata?.to ?? chunk.sourceAgentId ?? "agent");
      const message = String(chunk.metadata?.request ?? request);
      this.a2aResults.set(chunk.threadId, "");
      this.events.publish(conversationId, {
        type: "a2a_call",
        from,
        to,
        message,
        threadId: chunk.threadId,
      });
      this.events.publish(conversationId, {
        type: "tool_call_start",
        threadId: chunk.threadId,
        conversationId,
        parentMessageId,
        from,
        to,
        message,
      });
      return;
    }
    this.events.publish(conversationId, { type: "a2a_response", threadId: chunk.threadId, chunk });

    const chunkType = String(chunk.metadata?.chunkType ?? chunk.type);
    if (chunk.content && chunkType !== "thinking") {
      this.a2aResults.set(
        chunk.threadId,
        (this.a2aResults.get(chunk.threadId) ?? "") + chunk.content,
      );
    }
    if (chunkType === "error" || chunk.metadata?.status === "error") {
      this.events.publish(conversationId, {
        type: "tool_call_error",
        threadId: chunk.threadId,
        error: chunk.content || "Agent call failed",
      });
      this.a2aResults.delete(chunk.threadId);
    } else if (chunkType === "done" || chunk.metadata?.status === "done") {
      this.events.publish(conversationId, {
        type: "tool_call_result",
        threadId: chunk.threadId,
        result: this.a2aResults.get(chunk.threadId) ?? "",
      });
      this.a2aResults.delete(chunk.threadId);
    }
  }

  private async authorizeA2A(request: A2AAuthorizationRequest): Promise<A2AAuthorizationResult> {
    const mode = this.a2aPermissions.getPermission(request.conversationId);
    if (mode === "auto") return { approved: true };
    if (mode === "deny") return { approved: false, error: "A2A 调用已被禁用" };
    if (request.signal?.aborted) {
      return { approved: false, error: "A2A 调用未获批准" };
    }

    const expiresAt = Date.now() + 30_000;
    return new Promise<A2AAuthorizationResult>((resolve) => {
      const timeout = setTimeout(() => {
        const pending = this.pendingA2AConfirmations.get(request.threadId);
        if (!pending) return;
        this.clearPendingA2AConfirmation(request.threadId, pending);
        resolve({ approved: false, error: "A2A 调用确认超时" });
      }, 30_000);
      const abort = request.signal
        ? () => {
            const pending = this.pendingA2AConfirmations.get(request.threadId);
            if (!pending) return;
            this.clearPendingA2AConfirmation(request.threadId, pending);
            resolve({ approved: false, error: "A2A 调用未获批准" });
          }
        : undefined;
      this.pendingA2AConfirmations.set(request.threadId, {
        resolve,
        timeout,
        signal: request.signal,
        abort,
      });
      if (request.signal && abort) {
        request.signal.addEventListener("abort", abort, { once: true });
      }
      this.events.publish(request.conversationId, {
        type: "a2a_confirmation_required",
        threadId: request.threadId,
        from: request.fromAgentId,
        to: request.toAgentId,
        message: request.message,
        expiresAt,
      });
    });
  }

  private clearPendingA2AConfirmation(
    threadId: string,
    pending: typeof this.pendingA2AConfirmations extends Map<string, infer T> ? T : never,
  ): void {
    clearTimeout(pending.timeout);
    if (pending.signal && pending.abort) {
      pending.signal.removeEventListener("abort", pending.abort);
    }
    this.pendingA2AConfirmations.delete(threadId);
  }
}

function mentionKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function createMessage(input: Omit<Message, "id" | "timestamp">): Message {
  return { ...input, id: randomUUID(), timestamp: Date.now() };
}
