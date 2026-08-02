import { randomUUID } from "node:crypto";
import cron, { type ScheduledTask as CronTask } from "node-cron";
import type { AgentRuntime } from "../agent/runtime.js";
import type { Repository } from "../db/repository.js";
import { logger } from "../utils/logger.js";

export interface ScheduledAgentTask {
  id: string;
  agentId: string;
  conversationId: string;
  cronExpression: string;
  prompt: string;
  enabled: boolean;
  createdAt: number;
}

export class Scheduler {
  private readonly tasks = new Map<string, ScheduledAgentTask>();
  private readonly jobs = new Map<string, CronTask>();

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
    return task;
  }

  cancel(taskId: string): boolean {
    this.stop(taskId);
    this.tasks.delete(taskId);
    return this.repository.deleteScheduledTask(taskId);
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
    else this.stop(taskId);
    return updated;
  }

  destroy(): void {
    for (const taskId of this.jobs.keys()) this.stop(taskId);
  }

  private start(task: ScheduledAgentTask): void {
    this.stop(task.id);
    const job = cron.schedule(task.cronExpression, () => {
      void this.runtime.handleUserMessage(
        task.conversationId,
        task.prompt,
        [],
        task.agentId,
      ).catch((error: unknown) => {
        logger.error({ err: error, taskId: task.id, agentId: task.agentId }, "Scheduled task failed");
      });
    });
    this.jobs.set(task.id, job);
  }

  private stop(taskId: string): void {
    const job = this.jobs.get(taskId);
    job?.stop();
    job?.destroy();
    this.jobs.delete(taskId);
  }
}
