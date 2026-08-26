import { randomUUID } from "node:crypto";
import type {
  A2ACollaborationSettings,
  AppConfig,
  Message,
  MessageStatus,
  StreamChunk,
} from "@chorus/shared";
import { parseMentions, truncateHistory } from "@chorus/shared";
import type { Repository } from "../db/repository";
import type { EventHub } from "../ws/events";
import { messageFromError } from "./adapter";
import { A2ABus, type A2AAuthorizationRequest, type A2AAuthorizationResult } from "./a2a-bus";
import { AdapterMetrics, type AgentMetrics } from "./metrics";
import { A2APermissions, type A2APermissionMode } from "./permissions";
import type { AgentRegistry } from "./registry";
import { logger } from "../utils/logger";
import type { HubMessageRouter } from "../hub/message-router";
import type { RelayClient } from "../hub/relay-client";
import { buildAgentHandoff } from "./handoff";

export const DEFAULT_A2A_MAX_ROUNDS = 12;
export const MIN_A2A_MAX_ROUNDS = 1;
export const MAX_A2A_MAX_ROUNDS = 50;
export const DEFAULT_A2A_CALL_TIMEOUT_MINUTES = 5;
export const MIN_A2A_CALL_TIMEOUT_MINUTES = 1;
export const MAX_A2A_CALL_TIMEOUT_MINUTES = 30;
export const DEFAULT_A2A_TASK_TIMEOUT_MS = 20 * 60_000;
const A2A_MAX_ROUNDS_SETTING = "a2a.maxRounds";
const A2A_CALL_TIMEOUT_MINUTES_SETTING = "a2a.callTimeoutMinutes";

interface CollaborationRun {
  id: string;
  conversationId: string;
  objective: string;
  maxRounds: number;
  callTimeoutMs: number;
  taskTimeoutMs: number;
  roundsUsed: number;
  controller: AbortController;
  taskTimeout?: ReturnType<typeof setTimeout>;
  messageIds: Set<string>;
  limitNotified: boolean;
  timeoutNotified: boolean;
}

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
  private readonly collaborationRuns = new Map<string, CollaborationRun>();
  private readonly collaborationRunByMessageId = new Map<string, string>();
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
    this.a2aBus = new A2ABus(
      registry,
      undefined,
      relayClient,
      (request) => this.authorizeA2A(request),
      (update) =>
        events.publish(update.conversationId, {
          type: "hub_delivery_status",
          ...update,
        }),
    );
  }

  getA2APermission(conversationId: string): A2APermissionMode {
    return this.a2aPermissions.getPermission(conversationId);
  }

  setA2APermission(conversationId: string, mode: A2APermissionMode): void {
    this.a2aPermissions.setPermission(conversationId, mode);
  }

  getA2ACollaborationSettings(): A2ACollaborationSettings {
    const storedMaxRounds = Number(this.repository.getSetting(A2A_MAX_ROUNDS_SETTING));
    const storedCallTimeoutMinutes = Number(
      this.repository.getSetting(A2A_CALL_TIMEOUT_MINUTES_SETTING),
    );
    return {
      maxRounds:
        Number.isInteger(storedMaxRounds) &&
        storedMaxRounds >= MIN_A2A_MAX_ROUNDS &&
        storedMaxRounds <= MAX_A2A_MAX_ROUNDS
          ? storedMaxRounds
          : DEFAULT_A2A_MAX_ROUNDS,
      callTimeoutMinutes:
        Number.isInteger(storedCallTimeoutMinutes) &&
        storedCallTimeoutMinutes >= MIN_A2A_CALL_TIMEOUT_MINUTES &&
        storedCallTimeoutMinutes <= MAX_A2A_CALL_TIMEOUT_MINUTES
          ? storedCallTimeoutMinutes
          : DEFAULT_A2A_CALL_TIMEOUT_MINUTES,
    };
  }

  setA2ACollaborationSettings(
    settings: Partial<A2ACollaborationSettings>,
  ): A2ACollaborationSettings {
    if (
      settings.maxRounds !== undefined &&
      (!Number.isInteger(settings.maxRounds) ||
        settings.maxRounds < MIN_A2A_MAX_ROUNDS ||
        settings.maxRounds > MAX_A2A_MAX_ROUNDS)
    ) {
      throw new RangeError(
        `A2A max rounds must be an integer from ${MIN_A2A_MAX_ROUNDS} to ${MAX_A2A_MAX_ROUNDS}`,
      );
    }
    if (
      settings.callTimeoutMinutes !== undefined &&
      (!Number.isInteger(settings.callTimeoutMinutes) ||
        settings.callTimeoutMinutes < MIN_A2A_CALL_TIMEOUT_MINUTES ||
        settings.callTimeoutMinutes > MAX_A2A_CALL_TIMEOUT_MINUTES)
    ) {
      throw new RangeError(
        `A2A call timeout must be an integer from ${MIN_A2A_CALL_TIMEOUT_MINUTES} to ${MAX_A2A_CALL_TIMEOUT_MINUTES} minutes`,
      );
    }
    if (settings.maxRounds !== undefined) {
      this.repository.setSetting(A2A_MAX_ROUNDS_SETTING, String(settings.maxRounds));
    }
    if (settings.callTimeoutMinutes !== undefined) {
      this.repository.setSetting(
        A2A_CALL_TIMEOUT_MINUTES_SETTING,
        String(settings.callTimeoutMinutes),
      );
    }
    return this.getA2ACollaborationSettings();
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
    clientMessageId?: string,
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
      const errorMessage = createMessage({
        conversationId,
        fromType: "agent",
        fromId: explicitAgentId,
        content: "该 Agent 未加入此会话，请重新选择后再发送。",
        status: "error",
      });
      this.repository.saveMessage(errorMessage);
      this.events.publish(conversationId, { type: "message", message: errorMessage });
      logger.warn({ conversationId, explicitAgentId }, "Agent not assigned to conversation");
      return;
    }
    // @mentions are A2A hints only — they do NOT determine routing.
    // Routing: explicitAgentId (from request) > first online agent (group) > first agent (DM)
    const routingAgentIds = explicitAgentId ? [explicitAgentId] : [];
    const firstOnlineAgentId = conversation.agentIds.find(
      (agentId) => this.registry.getStatus(agentId) === "online",
    );
    const targetAgentIds =
      conversation.type === "group"
        ? routingAgentIds.length > 0
          ? routingAgentIds.filter((agentId) => this.registry.getStatus(agentId) === "online")
          : firstOnlineAgentId
            ? [firstOnlineAgentId]
            : []
        : [explicitAgentId ?? conversation.agentIds[0]].filter((agentId): agentId is string =>
            Boolean(agentId),
          );
    if (conversation.type !== "group" && targetAgentIds.length === 0) {
      throw new Error("No Agent is assigned to this conversation");
    }
    logger.info(
      {
        conversationId,
        conversationType: conversation.type,
        explicitAgentId,
        mentions,
        targetAgentIds,
        agentStatuses: conversation.agentIds.map((id) => ({
          id,
          status: this.registry.getStatus(id),
        })),
      },
      "Message routing decision",
    );

    const userMessage = createMessage(
      {
        conversationId,
        fromType: "user",
        fromId: "user",
        toType: "agent",
        toId: targetAgentIds.length === 1 ? targetAgentIds[0] : undefined,
        content,
        status: "done",
      },
      clientMessageId,
    );
    this.repository.saveMessage(userMessage);
    this.events.publish(conversationId, { type: "message", message: userMessage });

    const a2aMode = conversation.a2aMode ?? "mention";
    const collaborationRun =
      conversation.agentIds.length > 1 && a2aMode !== "off"
        ? this.createCollaborationRun(conversationId, userMessage.id, content)
        : undefined;
    try {
      await Promise.all(
        targetAgentIds.map((agentId) =>
          this.routeMessageToAgent(conversationId, agentId, content, mentions, collaborationRun),
        ),
      );
    } finally {
      if (collaborationRun) this.finishCollaborationRun(collaborationRun);
    }
  }

  private async routeMessageToAgent(
    conversationId: string,
    agentId: string,
    content: string,
    mentionedAgents: string[],
    collaborationRun?: CollaborationRun,
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
      return;
    }

    // Pre-flight: verify the CLI command actually exists before "thinking"
    if ("preflightCheck" in adapter && typeof adapter.preflightCheck === "function") {
      const preflight = await adapter.preflightCheck();
      if (!preflight.ok) {
        const errorMessage = createMessage({
          conversationId,
          fromType: "agent",
          fromId: agentId,
          content: `⚠️ ${preflight.detail ?? "Agent command not available."}`,
          status: "error",
        });
        this.repository.saveMessage(errorMessage);
        this.events.publish(conversationId, { type: "message", message: errorMessage });
        this.registry.setStatus(agentId, "error");
        logger.warn(
          { conversationId, agentId, detail: preflight.detail },
          "Agent preflight failed",
        );
        return;
      }
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
    if (collaborationRun) this.trackCollaborationMessage(collaborationRun, reply.id);
    await this.streamReply(reply, content, mentionedAgents, adapter, collaborationRun);
  }

  private async routeAgentMessage(
    conversationId: string,
    fromAgentId: string,
    toAgentId: string,
    content: string,
    parentMessageId?: string,
    collaborationRun?: CollaborationRun,
  ): Promise<void> {
    const conversation = this.repository.getConversation(conversationId);
    if (
      !conversation ||
      fromAgentId === toAgentId ||
      !conversation.agentIds.includes(fromAgentId) ||
      !conversation.agentIds.includes(toAgentId)
    ) {
      logger.warn(
        { conversationId, fromAgentId, toAgentId },
        "Ignored invalid agent message route",
      );
      return;
    }

    if (collaborationRun) {
      if (collaborationRun.controller.signal.aborted) return;
      if (collaborationRun.roundsUsed >= collaborationRun.maxRounds) {
        this.publishCollaborationLimit(collaborationRun);
        return;
      }
      collaborationRun.roundsUsed += 1;
    }

    const agentMessage = createMessage({
      conversationId,
      fromType: "agent",
      fromId: fromAgentId,
      toType: "agent",
      toId: toAgentId,
      content,
      status: "done",
      parentId: parentMessageId,
      metadata: collaborationRun
        ? {
            a2aRunId: collaborationRun.id,
            a2aRound: collaborationRun.roundsUsed,
            a2aMaxRounds: collaborationRun.maxRounds,
          }
        : undefined,
    });
    this.repository.saveMessage(agentMessage);
    this.events.publish(conversationId, { type: "message", message: agentMessage });

    const routedContent = collaborationRun
      ? buildAgentHandoff({
          objective: collaborationRun.objective,
          request: content,
          fromAgent: this.registry.get(fromAgentId)?.name ?? fromAgentId,
          toAgent: this.registry.get(toAgentId)?.name ?? toAgentId,
          history: this.repository.listMessages(conversationId),
          round: collaborationRun.roundsUsed,
          maxRounds: collaborationRun.maxRounds,
        })
      : content;
    await this.routeMessageToAgent(conversationId, toAgentId, routedContent, [], collaborationRun);
  }

  cancel(messageId: string): void {
    const collaborationRunId = this.collaborationRunByMessageId.get(messageId);
    const collaborationRun = collaborationRunId
      ? this.collaborationRuns.get(collaborationRunId)
      : undefined;
    collaborationRun?.controller.abort(
      new DOMException("Agent collaboration cancelled", "AbortError"),
    );
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
    collaborationRun?: CollaborationRun,
  ): Promise<void> {
    const controller = new AbortController();
    const signal = collaborationRun
      ? AbortSignal.any([controller.signal, collaborationRun.controller.signal])
      : controller.signal;
    const chunks: StreamChunk[] = [];
    let output = "";
    let agentMessagesToRoute: Array<{ agentId: string; content: string }> = [];
    const startedAt = Date.now();
    this.controllers.set(reply.id, controller);
    this.registry.setStatus(adapter.id, "busy");
    logger.info(
      { agentId: adapter.id, conversationId: reply.conversationId },
      "Agent invocation started",
    );
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
      const a2aMode = conversation?.a2aMode ?? "mention";
      const availableAgentIds = conversation?.agentIds ?? [adapter.id];
      const otherAgentIds = availableAgentIds.filter((id) => id !== adapter.id);
      const adapterAvailableAgentIds = a2aMode === "off" ? [adapter.id] : availableAgentIds;
      let augmentedContent = content;
      if (a2aMode === "mention" && conversation?.type === "group" && otherAgentIds.length > 0) {
        const agentNames = otherAgentIds.map((id) => this.registry.get(id)?.name ?? id);
        augmentedContent = `${content}\n\n--- System: You are in a group chat with: [${agentNames.join(", ")}]. To address another Agent, include the plain text "@Name" in your reply; the workspace routes it automatically. Do not use any built-in agent, subagent, or delegation tooling for this. Mention another Agent only when a concrete unresolved subtask requires that Agent. The mention must include useful context, the specific question, and the expected deliverable. Never mention an Agent for greetings, thanks, acknowledgements, or open-ended conversation. If the objective is complete, answer the user directly without another mention.`;
      }
      for await (const chunk of adapter.handleMessage(augmentedContent, {
        conversationId: reply.conversationId,
        history,
        a2aMode,
        mentionedAgents: a2aMode === "off" ? [] : mentionedAgents,
        availableAgentIds: adapterAvailableAgentIds,
        agentNames: Object.fromEntries(
          availableAgentIds.flatMap((id) => {
            const agent = this.registry.get(id);
            return agent ? [[id, agent.name] as const] : [];
          }),
        ),
        a2aBus: a2aMode === "off" ? undefined : this.a2aBus,
        callStack: [adapter.id],
        maxA2ARounds: collaborationRun?.maxRounds ?? this.getA2ACollaborationSettings().maxRounds,
        a2aCallTimeoutMs:
          collaborationRun?.callTimeoutMs ??
          this.getA2ACollaborationSettings().callTimeoutMinutes * 60_000,
        parentMessageId: reply.id,
        signal,
      })) {
        chunks.push(chunk);
        if (chunk.type === "text" && !chunk.threadId) output += chunk.content;
        this.events.publish(reply.conversationId, { type: "stream", messageId: reply.id, chunk });
        this.publishA2A(reply.conversationId, reply.id, adapter.id, content, chunk);
      }
      this.finish(reply, output, "done", chunks, startedAt, adapter.id);
      this.metrics.recordInvocation(adapter.id, Date.now() - startedAt, true);
      if (a2aMode === "mention" && conversation?.type === "group") {
        agentMessagesToRoute = findAgentMessages(
          output,
          otherAgentIds.map((id) => ({ id, name: this.registry.get(id)?.name ?? id })),
        );
      }
    } catch (error) {
      const cancelled =
        signal.aborted || (error instanceof DOMException && error.name === "AbortError");
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

    if (collaborationRun?.controller.signal.aborted) return;
    for (const agentMessage of agentMessagesToRoute) {
      await this.routeAgentMessage(
        reply.conversationId,
        adapter.id,
        agentMessage.agentId,
        agentMessage.content,
        reply.id,
        collaborationRun,
      );
    }
  }

  private createCollaborationRun(
    conversationId: string,
    rootMessageId: string,
    objective: string,
  ): CollaborationRun {
    const settings = this.getA2ACollaborationSettings();
    const controller = new AbortController();
    const callTimeoutMs = settings.callTimeoutMinutes * 60_000;
    const taskTimeoutMs = Math.max(DEFAULT_A2A_TASK_TIMEOUT_MS, callTimeoutMs);
    const run: CollaborationRun = {
      id: randomUUID(),
      conversationId,
      objective,
      maxRounds: settings.maxRounds,
      callTimeoutMs,
      taskTimeoutMs,
      roundsUsed: 0,
      controller,
      messageIds: new Set(),
      limitNotified: false,
      timeoutNotified: false,
    };
    run.taskTimeout = setTimeout(() => {
      this.publishCollaborationTimeout(run);
      controller.abort(new DOMException("Agent collaboration task timed out", "TimeoutError"));
    }, taskTimeoutMs);
    run.taskTimeout.unref?.();
    this.collaborationRuns.set(run.id, run);
    this.trackCollaborationMessage(run, rootMessageId);
    return run;
  }

  private trackCollaborationMessage(run: CollaborationRun, messageId: string): void {
    run.messageIds.add(messageId);
    this.collaborationRunByMessageId.set(messageId, run.id);
  }

  private finishCollaborationRun(run: CollaborationRun): void {
    if (run.taskTimeout) clearTimeout(run.taskTimeout);
    this.collaborationRuns.delete(run.id);
    for (const messageId of run.messageIds) this.collaborationRunByMessageId.delete(messageId);
  }

  private publishCollaborationLimit(run: CollaborationRun): void {
    if (run.limitNotified) return;
    run.limitNotified = true;
    const notice = createMessage({
      conversationId: run.conversationId,
      fromType: "agent",
      fromId: "chorus-system",
      content: `[system] Automatic collaboration stopped at the ${run.maxRounds}-round limit.`,
      status: "done",
      metadata: {
        systemNotice: "a2a_round_limit",
        a2aRunId: run.id,
        a2aRound: run.roundsUsed,
        a2aMaxRounds: run.maxRounds,
      },
    });
    this.repository.saveMessage(notice);
    this.events.publish(run.conversationId, { type: "message", message: notice });
    logger.warn(
      {
        conversationId: run.conversationId,
        runId: run.id,
        roundsUsed: run.roundsUsed,
        maxRounds: run.maxRounds,
      },
      "Agent collaboration reached the round limit",
    );
  }

  private publishCollaborationTimeout(run: CollaborationRun): void {
    if (run.timeoutNotified) return;
    run.timeoutNotified = true;
    const timeoutMinutes = Math.round(run.taskTimeoutMs / 60_000);
    const notice = createMessage({
      conversationId: run.conversationId,
      fromType: "agent",
      fromId: "chorus-system",
      content: `[system] Automatic collaboration stopped after the ${timeoutMinutes}-minute task limit.`,
      status: "done",
      metadata: {
        systemNotice: "a2a_task_timeout",
        a2aRunId: run.id,
        a2aTaskTimeoutMinutes: timeoutMinutes,
      },
    });
    this.repository.saveMessage(notice);
    this.events.publish(run.conversationId, { type: "message", message: notice });
    logger.warn(
      {
        conversationId: run.conversationId,
        runId: run.id,
        timeoutMinutes,
      },
      "Agent collaboration reached the task timeout",
    );
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

function findAgentMessages(
  output: string,
  agents: Array<{ id: string; name: string }>,
): Array<{ agentId: string; content: string }> {
  const messages = new Map<string, string>();

  for (const line of output.split(/\r?\n/u)) {
    // Skip quoted lines (e.g. mock adapter echoes user message with > prefix)
    if (/^\s*>/u.test(line)) continue;
    const matches = agents
      .map((agent) => ({ agent, index: findAgentMention(line, agent) }))
      .filter((match) => match.index >= 0)
      .sort((left, right) => left.index - right.index);
    if (matches.length === 0) continue;

    const content = line.slice(matches[0]?.index ?? 0).trim();
    if (!content) continue;
    for (const { agent } of matches) {
      if (!messages.has(agent.id)) messages.set(agent.id, content);
    }
  }

  return [...messages].map(([agentId, content]) => ({ agentId, content }));
}

function findAgentMention(line: string, agent: { id: string; name: string }): number {
  const tokens = [...new Set([agent.name, agent.id, mentionKey(agent.name)].filter(Boolean))].sort(
    (left, right) => right.length - left.length,
  );
  const normalizedLine = line.toLocaleLowerCase();

  for (const token of tokens) {
    const mention = `@${token.toLocaleLowerCase()}`;
    let index = normalizedLine.indexOf(mention);
    while (index >= 0) {
      const before = line[index - 1];
      const after = line[index + mention.length];
      const startsAtBoundary = index === 0 || !/[A-Za-z0-9_]/u.test(before ?? "");
      const endsAtBoundary =
        index + mention.length === line.length || /[\s.,!?;:，。！？；：)）\]}]/u.test(after ?? "");
      if (startsAtBoundary && endsAtBoundary) return index;
      index = normalizedLine.indexOf(mention, index + mention.length);
    }
  }

  return -1;
}

function createMessage(
  input: Omit<Message, "id" | "timestamp">,
  id: string = randomUUID(),
): Message {
  return { ...input, id, timestamp: Date.now() };
}
