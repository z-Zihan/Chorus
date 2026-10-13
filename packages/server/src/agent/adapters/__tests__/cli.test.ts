import type { A2ABusLike, ConversationContext, StreamChunk } from "@chorus/shared";
import { describe, expect, it, vi } from "vitest";
import { CliAdapter } from "../cli";

function context(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    conversationId: "conversation-1",
    history: [],
    ...overrides,
  };
}

async function collect(stream: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe("CliAdapter", () => {
  it("keeps A2A_CALL output visible in mention mode", async () => {
    const call = vi.fn();
    const a2aBus: A2ABusLike = {
      async *call(fromAgentId, toAgentId, message, callContext) {
        call(fromAgentId, toAgentId, message, callContext);
        yield { type: "done" as const, content: "" };
      },
    };
    const adapter = new CliAdapter("writer", "Writer");
    await adapter.init({
      command: process.execPath,
      args: ["-e", "process.stdout.write('[A2A_CALL: reviewer: Review this]')"],
      input: "argument",
      output: "plain",
    });

    const chunks = await collect(
      adapter.handleMessage(
        "Please review",
        context({
          a2aMode: "mention",
          availableAgentIds: ["writer", "reviewer"],
          a2aBus,
          callStack: ["writer"],
        }),
      ),
    );

    expect(call).not.toHaveBeenCalled();
    expect(chunks).toEqual([
      { type: "text", content: "[A2A_CALL: reviewer: Review this]\n" },
      { type: "done", content: "" },
    ]);
  });

  it("parses and executes A2A_CALL output in call mode", async () => {
    const call = vi.fn();
    const a2aBus: A2ABusLike = {
      async *call(fromAgentId, toAgentId, message, callContext) {
        call(fromAgentId, toAgentId, message, callContext);
        yield { type: "text" as const, content: "Looks good" };
        yield { type: "done" as const, content: "" };
      },
    };
    const adapter = new CliAdapter("writer", "Writer");
    await adapter.init({
      command: process.execPath,
      args: [
        "-e",
        "const p=process.argv[1]??'';process.stdout.write(p.includes('Responses from the agents you called:')?'Final answer':'[A2A_CALL: reviewer: Review this]')",
      ],
      input: "argument",
      output: "plain",
    });

    const chunks = await collect(
      adapter.handleMessage(
        "Please review",
        context({
          a2aMode: "call",
          availableAgentIds: ["writer", "reviewer"],
          a2aBus,
          callStack: ["writer"],
        }),
      ),
    );

    expect(call).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledWith(
      "writer",
      "reviewer",
      "Review this",
      expect.objectContaining({ a2aMode: "call", a2aThreadId: expect.any(String) }),
    );
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "tool_call",
      "a2a_response",
      "a2a_response",
      "text",
      "done",
    ]);
    expect(chunks[0]).toMatchObject({
      type: "tool_call",
      content: "Review this",
      sourceAgentId: "writer",
      metadata: { to: "reviewer", request: "Review this" },
    });
    expect(chunks[1]).toMatchObject({
      type: "a2a_response",
      content: "Looks good",
      sourceAgentId: "reviewer",
    });
    expect(chunks[3]).toEqual({ type: "text", content: "Final answer\n" });
  });

  it("does not interpret A2A_CALL output in off mode", async () => {
    const call = vi.fn();
    const a2aBus: A2ABusLike = {
      async *call() {
        call();
        yield { type: "done" as const, content: "" };
      },
    };
    const adapter = new CliAdapter("writer", "Writer");
    await adapter.init({
      command: process.execPath,
      args: ["-e", "process.stdout.write('[A2A_CALL: reviewer: Review this]')"],
      input: "argument",
      output: "plain",
    });

    const chunks = await collect(
      adapter.handleMessage(
        "Please review",
        context({
          a2aMode: "off",
          availableAgentIds: ["writer", "reviewer"],
          a2aBus,
        }),
      ),
    );

    expect(call).not.toHaveBeenCalled();
    expect(chunks).toEqual([
      { type: "text", content: "[A2A_CALL: reviewer: Review this]\n" },
      { type: "done", content: "" },
    ]);
  });

  it("passes the message through unchanged when A2A is disabled", async () => {
    const adapter = new CliAdapter("writer", "Writer");
    await adapter.init({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.argv[1] ?? '')"],
      input: "argument",
      output: "plain",
      a2aEnabled: false,
    });

    const chunks = await collect(
      adapter.handleMessage(
        "Original prompt",
        context({
          availableAgentIds: ["writer", "reviewer"],
        }),
      ),
    );

    expect(chunks).toEqual([
      { type: "text", content: "Original prompt\n" },
      { type: "done", content: "" },
    ]);
  });

  it("does not inject A2A instructions when no other agent is available", async () => {
    const adapter = new CliAdapter("writer", "Writer");
    await adapter.init({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.argv[1] ?? '')"],
      input: "argument",
      output: "plain",
    });

    const chunks = await collect(
      adapter.handleMessage(
        "Original prompt",
        context({
          availableAgentIds: ["writer"],
        }),
      ),
    );

    expect(chunks).toEqual([
      { type: "text", content: "Original prompt\n" },
      { type: "done", content: "" },
    ]);
  });

  it("counts every A2A handoff even when one CLI response requests several", async () => {
    const call = vi.fn();
    const a2aBus: A2ABusLike = {
      async *call() {
        call();
        yield { type: "text" as const, content: "Evidence" };
        yield { type: "done" as const, content: "" };
      },
    };
    const adapter = new CliAdapter("writer", "Writer");
    await adapter.init({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write('[A2A_CALL: reviewer: Review this][A2A_CALL: reviewer: Review again]')",
      ],
      input: "argument",
      output: "plain",
    });

    await expect(
      collect(
        adapter.handleMessage(
          "Please review",
          context({
            a2aMode: "call",
            availableAgentIds: ["writer", "reviewer"],
            a2aBus,
            maxA2ARounds: 1,
          }),
        ),
      ),
    ).rejects.toThrow("maximum of 1 A2A handoffs");
    expect(call).toHaveBeenCalledOnce();
  });

  // Grandchildren (git/node the CLI itself spawns) must be reaped on
  // terminate, not orphaned. Unix-only: Windows uses taskkill /T, which cannot
  // be exercised here. Processes self-exit after 30s as a leak backstop.
  it("kills the whole process tree when the request is aborted (unix)", async () => {
    if (process.platform === "win32") return;

    const adapter = new CliAdapter("tree", "Tree");
    await adapter.init({
      command: process.execPath,
      args: [
        "-e",
        [
          "const cp=require('node:child_process');",
          // Grandchild inherits the detached group of its parent CLI.
          "const gc=cp.spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),30000)'],{stdio:'ignore'});",
          "process.stdout.write('GCPID:'+gc.pid+'\\n');",
          // Keep the parent alive so the adapter is still streaming on abort.
          "setTimeout(()=>process.exit(0),30000);",
        ].join(""),
      ],
      input: "argument",
      output: "plain",
    });

    const controller = new AbortController();
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    let grandchildPid: number | undefined;
    try {
      const stream = adapter.handleMessage("go", context({ signal: controller.signal }));
      for await (const chunk of stream) {
        const match = /GCPID:(\d+)/u.exec(chunk.content);
        if (match) {
          grandchildPid = Number(match[1]);
          controller.abort();
          break;
        }
      }

      expect(grandchildPid).toBeDefined();
      const deadline = Date.now() + 5000;
      while (alive(grandchildPid as number) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(alive(grandchildPid as number)).toBe(false);
    } finally {
      adapter.destroy();
      if (grandchildPid !== undefined && alive(grandchildPid)) {
        try {
          process.kill(grandchildPid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
  });

  // A grandchild that ignores SIGTERM and outlives the CLI leader must still be
  // reaped: the SIGKILL escalation re-signals the whole group unconditionally,
  // so it cannot short-circuit on the (already-exited) leader. Unix-only.
  // The grandchild emits READY only after its SIGTERM-ignoring handler is
  // installed, and the leader gates GCPID on that — otherwise the group SIGTERM
  // could race ahead of the handler and reap it, hiding the escalation path.
  // Deadline covers the 3s SIGKILL grace window plus margin; processes self-exit
  // after 30s as a leak backstop.
  it("kills a SIGTERM-ignoring grandchild after the leader exits (unix)", async () => {
    if (process.platform === "win32") return;

    const adapter = new CliAdapter("tree", "Tree");
    await adapter.init({
      command: process.execPath,
      args: [
        "-e",
        [
          "const cp=require('node:child_process');",
          // Grandchild inherits the detached group but ignores SIGTERM, so only
          // the group SIGKILL escalation can reap it. It signals READY once the
          // handler is live.
          "const gc=cp.spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});process.stdout.write('READY');setTimeout(()=>process.exit(0),30000)\"],{stdio:['ignore','pipe','ignore']});",
          // Only report the pid after the grandchild confirms its handler, so
          // the test's abort cannot outrun the SIGTERM-ignore registration.
          "gc.stdout.on('data',d=>{if(String(d).includes('READY'))process.stdout.write('GCPID:'+gc.pid+'\\n');});",
          // Leader keeps default SIGTERM handling, so it exits on the group
          // SIGTERM — well before the SIGKILL escalation fires.
          "setTimeout(()=>process.exit(0),30000);",
        ].join(""),
      ],
      input: "argument",
      output: "plain",
    });

    const controller = new AbortController();
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    let grandchildPid: number | undefined;
    try {
      const stream = adapter.handleMessage("go", context({ signal: controller.signal }));
      for await (const chunk of stream) {
        const match = /GCPID:(\d+)/u.exec(chunk.content);
        if (match) {
          grandchildPid = Number(match[1]);
          controller.abort();
          break;
        }
      }

      expect(grandchildPid).toBeDefined();
      // SIGTERM is ignored, so ~1s after abort the grandchild must still be
      // alive — if it were already gone the test would be passing via the
      // SIGTERM path and never exercising the SIGKILL escalation.
      await new Promise((r) => setTimeout(r, 1000));
      expect(alive(grandchildPid as number)).toBe(true);
      // 3s SIGKILL grace + 5s margin: the SIGTERM-ignoring grandchild should be
      // gone once the escalation lands.
      const deadline = Date.now() + 10000;
      while (alive(grandchildPid as number) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(alive(grandchildPid as number)).toBe(false);
    } finally {
      adapter.destroy();
      if (grandchildPid !== undefined && alive(grandchildPid)) {
        try {
          process.kill(grandchildPid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }
  }, 30000);
});
