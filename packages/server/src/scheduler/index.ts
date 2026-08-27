import { randomUUID } from "node:crypto";
import cron, { type ScheduledTask as CronTask } from "node-cron";
import type { AgentRuntime } from "../agent/runtime.js";
import type { Repository } from "../db/repository.js";
import { logger } from "../utils/logger.js";

import type { ScheduledAgentTask } from "@chorus/shared";

export type { ScheduledAgentTask };

export class Scheduler {
  private readonly tasks = new Map<string, ScheduledAgentTask>();
  private readonly jobs = new Map<string, CronTask>();
  private readonly runningTasks = new Set<string>();

  constructor(
    private readonly repository: Repository,
    private readonly runtime: AgentRuntime,
  ) {}

  initialize(): void {
    for (const task of this.repository.listScheduledTasks()) {
      this.tasks.set(task.id, task);
      if (task.enabled) this.start(task);
    }
  }

  schedule(agentId: string, cronExpression: string, prompt: string): ScheduledAgentTask {
    if (!this.repository.getAgentRow(agentId)) throw new Error("Agent not found");
    if (!cron.validate(cronExpression)) throw new Error("Invalid cron expression");
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) throw new Error("Prompt is required");
    const conversation = this.repository.ensureDefaultConversation(agentId);
    const task: ScheduledAgentTask = {
      id: randomUUID(),
      agentId,
      conversationId: conversation.id,
      cronExpression,
      prompt: normalizedPrompt,
      enabled: true,
      createdAt: Date.now(),
    };
    this.repository.saveScheduledTask(task);
    this.tasks.set(task.id, task);
    this.start(task);
    return this.tasks.get(task.id) ?? task;
  }

  cancel(taskId: string): boolean {
    this.stop(taskId);
    this.tasks.delete(taskId);
    return this.repository.deleteScheduledTask(taskId);
  }

  /**
   * Unregister every in-memory job for a conversation whose DB rows were just
   * removed (conversation / agent deletion) — otherwise the cron keeps firing
   * for a deleted target until the process restarts.
   */
  cancelByConversation(conversationId: string): void {
    for (const task of this.tasks.values()) {
      if (task.conversationId !== conversationId) continue;
      this.stop(task.id);
      this.tasks.delete(task.id);
    }
  }

  cancelByAgent(agentId: string): void {
    for (const task of this.tasks.values()) {
      if (task.agentId !== agentId) continue;
      this.stop(task.id);
      this.tasks.delete(task.id);
    }
  }

  list(): ScheduledAgentTask[] {
    return [...this.tasks.values()].sort((left, right) => left.createdAt - right.createdAt);
  }

  setEnabled(taskId: string, enabled: boolean): ScheduledAgentTask | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    if (task.enabled === enabled) return task;
    const updated = { ...task, enabled };
    this.repository.setScheduledTaskEnabled(taskId, enabled);
    this.tasks.set(taskId, updated);
    if (enabled) this.start(updated);
    else {
      this.stop(taskId);
      this.markRun(taskId, { nextRunAt: null });
    }
    return this.tasks.get(taskId);
  }

  destroy(): void {
    for (const taskId of this.jobs.keys()) this.stop(taskId);
  }

  private start(task: ScheduledAgentTask): void {
    this.stop(task.id);
    const job = cron.schedule(task.cronExpression, () => {
      // LLM calls routinely outlast short cron intervals; a still-running task
      // skips the tick instead of stacking concurrent executions of one prompt.
      if (this.runningTasks.has(task.id)) {
        logger.warn(
          { taskId: task.id, agentId: task.agentId },
          "Scheduled task skipped: still running",
        );
        return;
      }
      this.runningTasks.add(task.id);
      void this.runtime
        .handleUserMessage(task.conversationId, task.prompt, [], task.agentId)
        .then(() => {
          this.markRun(task.id, { lastResult: "success" });
        })
        .catch((error: unknown) => {
          logger.error(
            { err: error, taskId: task.id, agentId: task.agentId },
            "Scheduled task failed",
          );
          this.markRun(task.id, { lastResult: "error" });
        })
        .finally(() => {
          this.runningTasks.delete(task.id);
        });
    });
    this.jobs.set(task.id, job);
    this.markRun(task.id, {});
  }

  private stop(taskId: string): void {
    const job = this.jobs.get(taskId);
    job?.stop();
    job?.destroy();
    this.jobs.delete(taskId);
  }

  /** Persist run metadata (fire time, outcome, next fire time) on a task. */
  private markRun(
    taskId: string,
    outcome: { lastResult?: string; nextRunAt?: number | null },
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const job = this.jobs.get(taskId);
    const lastResult =
      outcome.lastResult ?? (task.lastResult === undefined ? null : task.lastResult);
    const nextRunAt =
      outcome.nextRunAt === undefined ? (job?.getNextRun()?.getTime() ?? null) : outcome.nextRunAt;
    const lastRunAt = outcome.lastResult === undefined ? (task.lastRunAt ?? null) : Date.now();
    const updated: ScheduledAgentTask = {
      ...task,
      lastRunAt,
      lastResult,
      nextRunAt,
    };
    this.tasks.set(taskId, updated);
    this.repository.recordScheduledTaskRun(taskId, {
      lastRunAt: lastRunAt ?? 0,
      lastResult: lastResult ?? null,
      nextRunAt,
    });
  }
}
