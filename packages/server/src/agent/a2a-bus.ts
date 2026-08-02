import { randomUUID } from "node:crypto";
import type { A2ABusLike, ConversationContext, StreamChunk } from "@agentlink/shared";
import type { AgentRegistry } from "./registry";
import { track } from "../analytics";
import { logger } from "../utils/logger";

export interface A2ABusOptions {
  maxDepth: number;
  chainTimeoutMs: number;
  maxConcurrency: number;
}

export class A2ABus implements A2ABusLike {
  private readonly concurrency = new Map<string, number>();
  private readonly activeCalls = new Map<string, {
    controller: AbortController;
    children: Set<string>;
    parentThreadId?: string;
  }>();
  private readonly callsByStack = new Map<string, string[]>();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly options: A2ABusOptions = { maxDepth: 5, chainTimeoutMs: 60_000, maxConcurrency: 3 },
  ) {}

  async *call(
    fromAgentId: string,
    toAgentId: string,
    message: string,
    context: ConversationContext,
  ): AsyncGenerator<StreamChunk> {
    const stack = context.callStack ?? [fromAgentId];
    const threadId = context.a2aThreadId ?? randomUUID();
    if (stack.includes(toAgentId)) {
      yield { type: "error", content: `检测到循环调用: ${stack.join(" → ")} → ${toAgentId}`, threadId };
      return;
    }
    if (stack.length >= this.options.maxDepth) {
      yield { type: "error", content: `超过最大调用深度 ${this.options.maxDepth}`, threadId };
      return;
    }
    const active = this.concurrency.get(toAgentId) ?? 0;
    if (active >= this.options.maxConcurrency) {
      yield { type: "error", content: `Agent ${toAgentId} 并发数已达上限`, threadId };
      return;
    }
    const adapter = this.registry.getAdapter(toAgentId);
    if (!adapter?.handleA2ACall || this.registry.getStatus(toAgentId) !== "online") {
      yield { type: "error", content: `Agent ${toAgentId} 当前不可用`, threadId };
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
    try {
      const stream = adapter.handleA2ACall(fromAgentId, message, {
        ...context,
        callStack: nextStack,
        a2aThreadId: undefined,
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
      track("error", { message: error instanceof Error ? error.message : String(error), source: "a2a_bus" });
      throw error;
    } finally {
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
