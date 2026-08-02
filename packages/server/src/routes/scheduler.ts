import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Scheduler } from "../scheduler/index.js";

const createTaskSchema = z.object({
  agentId: z.string().trim().min(1).max(64),
  cronExpression: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(32_000),
});
const updateTaskSchema = z.object({ enabled: z.boolean() });

export function registerSchedulerRoutes(app: FastifyInstance, scheduler: Scheduler): void {
  app.get("/api/scheduler/tasks", async () => scheduler.list());

  app.post("/api/scheduler/tasks", async (request, reply) => {
    const parsed = createTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid scheduled task", issues: parsed.error.flatten() });
    }
    try {
      return reply.code(201).send(scheduler.schedule(
        parsed.data.agentId,
        parsed.data.cronExpression,
        parsed.data.prompt,
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to schedule task";
      return reply.code(message === "Agent not found" ? 404 : 400).send({ error: message });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/scheduler/tasks/:id", async (request, reply) => {
    const deleted = scheduler.cancel(request.params.id);
    if (!deleted) return reply.code(404).send({ error: "Scheduled task not found" });
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>("/api/scheduler/tasks/:id", async (request, reply) => {
    const parsed = updateTaskSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid scheduled task update" });
    const task = scheduler.setEnabled(request.params.id, parsed.data.enabled);
    if (!task) return reply.code(404).send({ error: "Scheduled task not found" });
    return task;
  });
}
