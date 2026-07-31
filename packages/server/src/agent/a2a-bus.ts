import { randomUUID } from "node:crypto";
import type { A2ABusLike, ConversationContext, StreamChunk } from "@agentlink/shared";
import type { AgentRegistry } from "./registry";

export interface A2ABusOptions {
  maxDepth: number;
  chainTimeoutMs: number;
  maxConcurrency: number;
}

export class A2ABus implements A2ABusLike {
  private readonly concurrency = new Map<string, number>();

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
    const threadId = randomUUID();
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
    try {
      for await (const chunk of adapter.handleA2ACall(fromAgentId, message, {
        ...context,
        callStack: [...stack, toAgentId],
        signal: AbortSignal.any([timeout, ...(context.signal ? [context.signal] : [])]),
      })) {
        yield { ...chunk, threadId, sourceAgentId: toAgentId };
      }
    } finally {
      if (active === 0) this.concurrency.delete(toAgentId);
      else this.concurrency.set(toAgentId, active);
    }
  }
}
