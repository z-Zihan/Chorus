import type { AgentAdapter, ConversationContext } from "@chorus/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { A2ABus } from "./a2a-bus";
import type { AgentRegistry } from "./registry";

describe("A2ABus time limits", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the per-task call timeout instead of the former 60-second limit", async () => {
    vi.useFakeTimers();
    const adapter = {
      handleA2ACall: async function* (
        _from: string,
        _message: string,
        context: ConversationContext,
      ) {
        await new Promise<never>((_, reject) => {
          const abort = () => reject(context.signal?.reason);
          context.signal?.addEventListener("abort", abort, { once: true });
        });
      },
    } as Pick<AgentAdapter, "handleA2ACall">;
    const registry = {
      get: (id: string) => ({ id, name: id }),
      getAdapter: (id: string) => (id === "callee" ? adapter : undefined),
      getStatus: () => "online",
      getRemoteAgentHub: () => undefined,
    } as unknown as AgentRegistry;
    const bus = new A2ABus(registry, {
      maxDepth: 5,
      callTimeoutMs: 5 * 60_000,
      maxConcurrency: 3,
    });
    const call = bus
      .call("caller", "callee", "work", {
        conversationId: "conversation-1",
        history: [],
        callStack: ["caller"],
        a2aCallTimeoutMs: 2 * 60_000,
      })
      .next()
      .then(() => undefined);
    const assertion = expect(call).rejects.toMatchObject({
      name: "TimeoutError",
      message: "Agent call timed out after 2 minutes",
    });

    await vi.advanceTimersByTimeAsync(60_000);
    let settled = false;
    void call.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });
});
