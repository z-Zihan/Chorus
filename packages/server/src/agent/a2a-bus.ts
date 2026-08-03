import { randomUUID } from "node:crypto";
import type { A2ABusLike, ConversationContext, StreamChunk } from "@agentlink/shared";
import type { AgentRegistry } from "./registry";
import { track } from "../analytics";
import { logger } from "../utils/logger";
import type { HubMessageRouter } from "../hub/message-router";
import type { RelayClient } from "../hub/relay-client";

export interface A2ABusOptions {
  maxDepth: number;
  chainTimeoutMs: number;
  maxConcurrency: number;
}

export interface A2AAuthorizationRequest {
  conversationId: string;
  threadId: string;
  fromAgentId: string;
  toAgentId: string;
  message: string;
  signal?: AbortSignal;
}

export interface A2AAuthorizationResult {
  approved: boolean;
  error?: string;
}

export type A2AAuthorizer = (request: A2AAuthorizationRequest) => Promise<A2AAuthorizationResult>;

export class A2ABus implements A2ABusLike {
  private readonly concurrency = new Map<string, number>();
  private readonly activeCalls = new Map<
    string,
    {
      controller: AbortController;
      children: Set<string>;
      parentThreadId?: string;
    }
  >();
  private readonly callsByStack = new Map<string, string[]>();
  private hubMessageRouter?: HubMessageRouter;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly options: A2ABusOptions = {
      maxDepth: 5,
      chainTimeoutMs: 60_000,
      maxConcurrency: 3,
    },
    private readonly relayClient?: RelayClient,
    private readonly authorize?: A2AAuthorizer,
  ) {}

  setHubMessageRouter(router: HubMessageRouter): void {
    this.hubMessageRouter = router;
  }

  async *call(
    fromAgentId: string,
    toAgentId: string,
    message: string,
    context: ConversationContext,
  ): AsyncGenerator<StreamChunk> {
    const stack = context.callStack ?? [fromAgentId];
    const threadId = context.a2aThreadId ?? randomUUID();
    if (stack.includes(toAgentId)) {
      yield {
        type: "error",
        content: `检测到循环调用: ${stack.join(" → ")} → ${toAgentId}`,
        threadId,
      };
      return;
    }
    if (stack.length >= this.options.maxDepth) {
      yield { type: "error", content: `超过最大调用深度 ${this.options.maxDepth}`, threadId };
      return;
    }
    const authorization = await this.authorize?.({
      conversationId: context.conversationId,
      threadId,
      fromAgentId,
      toAgentId,
      message,
      signal: context.signal,
    });
    if (authorization && !authorization.approved) {
      yield {
        type: "error",
        content: authorization.error ?? "A2A 调用未获批准",
        threadId,
        sourceAgentId: toAgentId,
      };
      return;
    }
    const remoteHubId = this.registry.getRemoteAgentHub(toAgentId);
    if (remoteHubId) {
      if (!this.hubMessageRouter) {
        yield { type: "error", content: "跨 Hub 消息路由不可用", threadId };
        return;
      }
      if (this.relayClient?.state !== "connected") {
        yield { type: "error", content: "Relay 当前未连接", threadId };
        return;
      }
      const separatorIndex = toAgentId.startsWith(remoteHubId) ? remoteHubId.length : -1;
      const remoteAgentId =
        separatorIndex >= 0 && [":", "/"].includes(toAgentId[separatorIndex] ?? "")
          ? toAgentId.slice(separatorIndex + 1)
          : toAgentId;
      const response = await this.hubMessageRouter.callRemoteAgent(
        remoteHubId,
        fromAgentId,
        remoteAgentId,
        message,
        { ...context, callStack: [...stack, toAgentId], a2aThreadId: threadId },
      );
      yield { type: "text", content: response, threadId, sourceAgentId: toAgentId };
      yield { type: "done", content: "", threadId, sourceAgentId: toAgentId };
      return;
    }
    const active = this.concurrency.get(toAgentId) ?? 0;
    if (active >= this.options.maxConcurrency) {
      yield { type: "error", content: `Agent ${toAgentId} 并发数已达上限`, threadId };
      return;
    }
    const adapter = this.registry.getAdapter(toAgentId);
    if (
      !adapter?.handleA2ACall ||
      (this.registry.getStatus(toAgentId) !== "online" &&
        this.registry.getStatus(toAgentId) !== "busy")
    ) {
      const status = this.registry.getStatus(toAgentId);
      logger.warn(
        {
          toAgentId,
          status,
          hasAdapter: Boolean(adapter),
          hasHandleA2A: Boolean(adapter?.handleA2ACall),
        },
        "A2A target agent unavailable",
      );
      yield {
        type: "error",
        content: `Agent ${toAgentId} 当前不可用 (status: ${status})`,
        threadId,
      };
      return;
    }

    this.concurrency.set(toAgentId, active + 1);
    const timeout = AbortSignal.timeout(this.options.chainTimeoutMs);
    const controller = new AbortController();
    const parentThreadId = this.callsByStack.get(stackKey(stack))?.at(-1);
    const nextStack = [...stack, toAgentId];
    const nextStackKey = stackKey(nextStack);
    const stackCalls = this.callsByStack.get(nextStackKey) ?? [];
    stackCalls.push(threadId);
    this.callsByStack.set(nextStackKey, stackCalls);
    this.activeCalls.set(threadId, { controller, children: new Set(), parentThreadId });
    if (parentThreadId) this.activeCalls.get(parentThreadId)?.children.add(threadId);
    const signal = AbortSignal.any([
      controller.signal,
      timeout,
      ...(context.signal ? [context.signal] : []),
    ]);
    const startedAt = Date.now();
    logger.info({ fromAgentId, toAgentId, threadId }, "A2A call started");
    track("a2a_call_start", { fromAgentId, toAgentId, threadId });
    let stream: AsyncGenerator<StreamChunk> | null = null;
    try {
      const callerName = this.registry.get(fromAgentId)?.name ?? fromAgentId;
      const contextSummary = summarizeContext(context.history);
      stream = adapter.handleA2ACall(fromAgentId, message, {
        ...context,
        callStack: nextStack,
        a2aThreadId: undefined,
        a2aCallerName: callerName,
        a2aContextSummary: contextSummary,
        signal,
      });
      while (true) {
        const next = await nextWithSignal(stream.next(), signal);
        if (next.done) break;
        const chunk = next.value;
        yield { ...chunk, threadId, sourceAgentId: toAgentId };
      }
    } catch (error) {
      logger.error({ err: error, fromAgentId, toAgentId, threadId }, "A2A call failed");
      track("error", {
        message: error instanceof Error ? error.message : String(error),
        source: "a2a_bus",
      });
      throw error;
    } finally {
      // Ensure the adapter generator is closed even when we bailed on abort/timeout
      stream?.return(undefined).catch(() => {});
      const durationMs = Date.now() - startedAt;
      logger.info({ fromAgentId, toAgentId, threadId, durationMs }, "A2A call ended");
      track("a2a_call_end", { fromAgentId, toAgentId, threadId, durationMs });
      const calls = this.callsByStack.get(nextStackKey) ?? [];
      const index = calls.lastIndexOf(threadId);
      if (index >= 0) calls.splice(index, 1);
      if (calls.length === 0) this.callsByStack.delete(nextStackKey);
      else this.callsByStack.set(nextStackKey, calls);
      if (parentThreadId) this.activeCalls.get(parentThreadId)?.children.delete(threadId);
      this.activeCalls.delete(threadId);
      if (active === 0) this.concurrency.delete(toAgentId);
      else this.concurrency.set(toAgentId, active);
    }
  }

  cancel(threadId: string): boolean {
    const call = this.activeCalls.get(threadId);
    if (!call) return false;
    for (const childThreadId of [...call.children]) this.cancel(childThreadId);
    call.controller.abort(new DOMException("A2A call cancelled", "AbortError"));
    return true;
  }
}

function summarizeContext(history: ConversationContext["history"]): string {
  const messages = history.slice(-5).map((message) => {
    const speaker = message.fromType === "user" ? "User" : message.fromId;
    const content = message.content.replace(/\s+/gu, " ").trim();
    return `${speaker}: ${content.length > 240 ? `${content.slice(0, 237)}...` : content}`;
  });
  const summary = messages.join("\n");
  return summary.length > 1_200 ? `${summary.slice(0, 1_197)}...` : summary;
}

function stackKey(stack: string[]): string {
  return stack.join("\u0000");
}

function nextWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException("A2A call aborted", "AbortError"));
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
