import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntime } from "../agent/runtime.js";
import type { Repository } from "../db/repository.js";
import { Scheduler } from "./index.js";

import type { ScheduledAgentTask } from "@chorus/shared";

// node-cron's internal heartbeat uses setTimeout keyed off wall-clock minute
// boundaries, so fake timers + vi.setSystemTime reliably drive real ticks
// (verified experimentally) — no need to mock node-cron itself.

function makeRepository(overrides: Record<string, unknown> = {}): Repository {
  const base = {
    listScheduledTasks: vi.fn(() => [] as ScheduledAgentTask[]),
    getAgentRow: vi.fn(() => ({ id: "agent-1" }) as unknown),
    ensureDefaultConversation: vi.fn(() => ({ id: "conv-1" }) as unknown),
    saveScheduledTask: vi.fn(),
    deleteScheduledTask: vi.fn(() => true),
    setScheduledTaskEnabled: vi.fn(() => true),
    recordScheduledTaskRun: vi.fn(() => true),
  };
  return { ...base, ...overrides } as unknown as Repository;
}

function makeRuntime(overrides: Record<string, unknown> = {}): AgentRuntime {
  const base = {
    handleUserMessage: vi.fn(async () => undefined),
  };
  return { ...base, ...overrides } as unknown as AgentRuntime;
}

describe("Scheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("schedule", () => {
    it("throws when the agent does not exist", () => {
      const repository = makeRepository({ getAgentRow: vi.fn(() => undefined) });
      const scheduler = new Scheduler(repository, makeRuntime());

      expect(() => scheduler.schedule("missing-agent", "* * * * *", "Run")).toThrow(
        "Agent not found",
      );
    });

    it("throws when the cron expression is invalid", () => {
      const repository = makeRepository();
      const scheduler = new Scheduler(repository, makeRuntime());

      expect(() => scheduler.schedule("agent-1", "not a cron", "Run")).toThrow(
        "Invalid cron expression",
      );
    });

    it("throws when the prompt is blank after trimming", () => {
      const repository = makeRepository();
      const scheduler = new Scheduler(repository, makeRuntime());

      expect(() => scheduler.schedule("agent-1", "* * * * *", "   ")).toThrow("Prompt is required");
    });

    it("creates an enabled task with a trimmed prompt linked to the default conversation", () => {
      const repository = makeRepository();
      const scheduler = new Scheduler(repository, makeRuntime());

      const task = scheduler.schedule("agent-1", "* * * * *", "  Summarize things  ");

      expect(task).toMatchObject({
        agentId: "agent-1",
        conversationId: "conv-1",
        cronExpression: "* * * * *",
        prompt: "Summarize things",
        enabled: true,
      });
      expect(repository.ensureDefaultConversation).toHaveBeenCalledWith("agent-1");
      expect(repository.saveScheduledTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: task.id, prompt: "Summarize things" }),
      );
      expect(scheduler.list()).toEqual([task]);

      scheduler.destroy();
    });
  });

  describe("initialize", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    });

    it("restores tasks from the repository and only starts a cron job for the enabled ones", async () => {
      const enabledTask: ScheduledAgentTask = {
        id: "task-enabled",
        agentId: "agent-enabled",
        conversationId: "conv-enabled",
        cronExpression: "* * * * *",
        prompt: "Run enabled",
        enabled: true,
        createdAt: 1,
        lastRunAt: null,
        lastResult: null,
        nextRunAt: null,
      };
      const disabledTask: ScheduledAgentTask = {
        id: "task-disabled",
        agentId: "agent-disabled",
        conversationId: "conv-disabled",
        cronExpression: "* * * * *",
        prompt: "Run disabled",
        enabled: false,
        createdAt: 2,
        lastRunAt: null,
        lastResult: null,
        nextRunAt: null,
      };
      const repository = makeRepository({
        listScheduledTasks: vi.fn(() => [enabledTask, disabledTask]),
      });
      const runtime = makeRuntime();
      const scheduler = new Scheduler(repository, runtime);

      scheduler.initialize();
      expect(scheduler.list().map((task) => task.id)).toEqual(["task-enabled", "task-disabled"]);
      expect(scheduler.list()[1]).toEqual(disabledTask);

      await vi.advanceTimersByTimeAsync(60_000);

      expect(runtime.handleUserMessage).toHaveBeenCalledTimes(1);
      expect(runtime.handleUserMessage).toHaveBeenCalledWith(
        "conv-enabled",
        "Run enabled",
        [],
        "agent-enabled",
      );

      scheduler.destroy();
    });
  });

  describe("tick execution", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    });

    it("marks the task lastResult success after handleUserMessage resolves", async () => {
      const repository = makeRepository();
      let resolveMessage: (() => void) | undefined;
      const runtime = makeRuntime({
        handleUserMessage: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveMessage = resolve;
            }),
        ),
      });
      const scheduler = new Scheduler(repository, runtime);
      const task = scheduler.schedule("agent-1", "* * * * *", "Run");

      await vi.advanceTimersByTimeAsync(60_000);
      expect(runtime.handleUserMessage).toHaveBeenCalledTimes(1);
      expect(runtime.handleUserMessage).toHaveBeenCalledWith(
        task.conversationId,
        task.prompt,
        [],
        task.agentId,
      );

      resolveMessage?.();
      await vi.advanceTimersByTimeAsync(0);

      expect(repository.recordScheduledTaskRun).toHaveBeenLastCalledWith(
        task.id,
        expect.objectContaining({ lastResult: "success" }),
      );
      expect(scheduler.list()[0]?.lastResult).toBe("success");

      scheduler.destroy();
    });

    it("marks the task lastResult error when handleUserMessage rejects, without throwing", async () => {
      const repository = makeRepository();
      let rejectMessage: ((error: Error) => void) | undefined;
      const runtime = makeRuntime({
        handleUserMessage: vi.fn(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectMessage = reject;
            }),
        ),
      });
      const scheduler = new Scheduler(repository, runtime);
      const task = scheduler.schedule("agent-1", "* * * * *", "Run");

      await vi.advanceTimersByTimeAsync(60_000);
      expect(runtime.handleUserMessage).toHaveBeenCalledTimes(1);

      rejectMessage?.(new Error("boom"));
      await vi.advanceTimersByTimeAsync(0);

      expect(repository.recordScheduledTaskRun).toHaveBeenLastCalledWith(
        task.id,
        expect.objectContaining({ lastResult: "error" }),
      );
      expect(scheduler.list()[0]?.lastResult).toBe("error");

      scheduler.destroy();
    });

    it("skips a tick while the previous run is still in flight, then resumes afterward", async () => {
      const repository = makeRepository();
      let resolveFirst: (() => void) | undefined;
      const handleUserMessage = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockImplementation(async () => undefined);
      const runtime = makeRuntime({ handleUserMessage });
      const scheduler = new Scheduler(repository, runtime);
      scheduler.schedule("agent-1", "* * * * *", "Run");

      await vi.advanceTimersByTimeAsync(60_000);
      expect(handleUserMessage).toHaveBeenCalledTimes(1);

      // Second tick fires while the first call is still pending: it should
      // be skipped rather than stacking a concurrent execution.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(handleUserMessage).toHaveBeenCalledTimes(1);

      resolveFirst?.();
      await vi.advanceTimersByTimeAsync(0);

      // Now that the run finished, the next tick should execute normally.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(handleUserMessage).toHaveBeenCalledTimes(2);

      scheduler.destroy();
    });
  });

  describe("cancelByConversation / cancelByAgent", () => {
    it("stops and removes only the tasks matching the given conversation", () => {
      const repository = makeRepository();
      const scheduler = new Scheduler(repository, makeRuntime());
      const matching = scheduler.schedule("agent-1", "* * * * *", "Run A");
      repository.ensureDefaultConversation = vi.fn(() => ({ id: "conv-2" }) as unknown) as never;
      const other = scheduler.schedule("agent-1", "* * * * *", "Run B");

      scheduler.cancelByConversation(matching.conversationId);

      const remaining = scheduler.list();
      expect(remaining).toEqual([other]);
      expect(repository.deleteScheduledTask).not.toHaveBeenCalled();

      scheduler.destroy();
    });

    it("stops and removes only the tasks matching the given agent", () => {
      const repository = makeRepository();
      const scheduler = new Scheduler(repository, makeRuntime());
      const matching = scheduler.schedule("agent-1", "* * * * *", "Run A");
      repository.getAgentRow = vi.fn(() => ({ id: "agent-2" }) as unknown) as never;
      const other = scheduler.schedule("agent-2", "* * * * *", "Run B");

      scheduler.cancelByAgent(matching.agentId);

      expect(scheduler.list()).toEqual([other]);

      scheduler.destroy();
    });

    it("leaves unrelated tasks untouched when nothing matches", () => {
      const repository = makeRepository();
      const scheduler = new Scheduler(repository, makeRuntime());
      const task = scheduler.schedule("agent-1", "* * * * *", "Run A");

      scheduler.cancelByConversation("some-other-conversation");
      scheduler.cancelByAgent("some-other-agent");

      expect(scheduler.list()).toEqual([task]);

      scheduler.destroy();
    });
  });

  describe("setEnabled", () => {
    it("registers a job and persists enabled=true when flipping false -> true", () => {
      const repository = makeRepository();
      const scheduler = new Scheduler(repository, makeRuntime());
      const task = scheduler.schedule("agent-1", "* * * * *", "Run");
      scheduler.setEnabled(task.id, false);
      repository.setScheduledTaskEnabled = vi.fn(() => true) as never;

      const result = scheduler.setEnabled(task.id, true);

      expect(result?.enabled).toBe(true);
      expect(repository.setScheduledTaskEnabled).toHaveBeenCalledWith(task.id, true);

      scheduler.destroy();
    });

    it("stops the job and sets nextRunAt to null when flipping true -> false", () => {
      const repository = makeRepository();
      const scheduler = new Scheduler(repository, makeRuntime());
      const task = scheduler.schedule("agent-1", "* * * * *", "Run");

      const result = scheduler.setEnabled(task.id, false);

      expect(result?.enabled).toBe(false);
      expect(result?.nextRunAt).toBeNull();
      expect(repository.setScheduledTaskEnabled).toHaveBeenCalledWith(task.id, false);
      expect(repository.recordScheduledTaskRun).toHaveBeenLastCalledWith(
        task.id,
        expect.objectContaining({ nextRunAt: null }),
      );

      scheduler.destroy();
    });

    it("is idempotent and skips persistence when the value is unchanged", () => {
      const repository = makeRepository();
      const scheduler = new Scheduler(repository, makeRuntime());
      const task = scheduler.schedule("agent-1", "* * * * *", "Run");
      repository.setScheduledTaskEnabled = vi.fn(() => true) as never;

      const result = scheduler.setEnabled(task.id, true);

      expect(result).toEqual(task);
      expect(repository.setScheduledTaskEnabled).not.toHaveBeenCalled();

      scheduler.destroy();
    });

    it("returns undefined for an unknown taskId", () => {
      const repository = makeRepository();
      const scheduler = new Scheduler(repository, makeRuntime());

      expect(scheduler.setEnabled("does-not-exist", true)).toBeUndefined();

      scheduler.destroy();
    });
  });

  describe("destroy", () => {
    it("stops every registered job without throwing", () => {
      const repository = makeRepository();
      const scheduler = new Scheduler(repository, makeRuntime());
      scheduler.schedule("agent-1", "* * * * *", "Run A");
      scheduler.schedule("agent-1", "* * * * *", "Run B");

      expect(() => scheduler.destroy()).not.toThrow();
    });
  });

  describe("list", () => {
    it("returns tasks sorted by createdAt ascending", () => {
      const later: ScheduledAgentTask = {
        id: "task-later",
        agentId: "agent-1",
        conversationId: "conv-1",
        cronExpression: "* * * * *",
        prompt: "Later",
        enabled: false,
        createdAt: 200,
        lastRunAt: null,
        lastResult: null,
        nextRunAt: null,
      };
      const earlier: ScheduledAgentTask = {
        id: "task-earlier",
        agentId: "agent-1",
        conversationId: "conv-1",
        cronExpression: "* * * * *",
        prompt: "Earlier",
        enabled: false,
        createdAt: 100,
        lastRunAt: null,
        lastResult: null,
        nextRunAt: null,
      };
      const repository = makeRepository({
        listScheduledTasks: vi.fn(() => [later, earlier]),
      });
      const scheduler = new Scheduler(repository, makeRuntime());

      scheduler.initialize();

      expect(scheduler.list().map((task) => task.id)).toEqual(["task-earlier", "task-later"]);
    });
  });
});
