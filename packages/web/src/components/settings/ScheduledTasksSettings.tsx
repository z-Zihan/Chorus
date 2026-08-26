import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarClock, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAgentStore } from "@/store/agentStore";
import { useSchedulerStore, type ScheduledTask } from "@/store/schedulerStore";
import { useUIStore } from "@/store/uiStore";

export function ScheduledTasksSettings() {
  const { t } = useTranslation(["common", "settings"]);
  const tasks = useSchedulerStore((state) => state.tasks);
  const isLoading = useSchedulerStore((state) => state.isLoading);
  const loadError = useSchedulerStore((state) => state.loadError);
  const fetchTasks = useSchedulerStore((state) => state.fetchTasks);
  const createTask = useSchedulerStore((state) => state.createTask);
  const deleteTask = useSchedulerStore((state) => state.deleteTask);
  const toggleTask = useSchedulerStore((state) => state.toggleTask);
  const agents = useAgentStore((state) => state.agents);
  const agentsLoading = useAgentStore((state) => state.isLoading);
  const agentsError = useAgentStore((state) => state.loadError);
  const fetchAgents = useAgentStore((state) => state.fetchAgents);
  const [showForm, setShowForm] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [prompt, setPrompt] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});
  const [taskToDelete, setTaskToDelete] = useState<ScheduledTask | null>(null);

  useEffect(() => {
    void fetchTasks();
    void fetchAgents();
  }, [fetchAgents, fetchTasks]);

  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  const resetForm = () => {
    setShowForm(false);
    setAgentId("");
    setCronExpression("0 9 * * *");
    setPrompt("");
    setFormError(null);
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!agentId || !cronExpression.trim() || !prompt.trim()) {
      setFormError(t("settings:scheduler.requiredFields"));
      return;
    }
    setIsCreating(true);
    setFormError(null);
    try {
      await createTask({ agentId, cronExpression: cronExpression.trim(), prompt: prompt.trim() });
      useUIStore.getState().addToast(t("settings:scheduler.created"), "success");
      resetForm();
    } catch (error) {
      setFormError(readSchedulerError(error, t));
    } finally {
      setIsCreating(false);
    }
  };

  const handleToggle = async (task: ScheduledTask, enabled: boolean) => {
    setPendingTaskId(task.id);
    setTaskErrors((current) => omitKey(current, task.id));
    try {
      await toggleTask(task.id, enabled);
    } catch {
      setTaskErrors((current) => ({
        ...current,
        [task.id]: t("settings:scheduler.toggleFailed"),
      }));
    } finally {
      setPendingTaskId(null);
    }
  };

  const handleDelete = async () => {
    if (!taskToDelete) return;
    const taskId = taskToDelete.id;
    setPendingTaskId(taskId);
    setTaskErrors((current) => omitKey(current, taskId));
    try {
      await deleteTask(taskId);
      setTaskToDelete(null);
      useUIStore.getState().addToast(t("settings:scheduler.deleted"), "success");
    } catch {
      setTaskToDelete(null);
      setTaskErrors((current) => ({
        ...current,
        [taskId]: t("settings:scheduler.deleteFailed"),
      }));
    } finally {
      setPendingTaskId(null);
    }
  };

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {t("common:scheduler.title")}
          </h2>
          <p className="mt-1 text-xs leading-5 text-[var(--text-tertiary)]">
            {t("settings:scheduler.description")}
          </p>
        </div>
        <Button
          size="sm"
          className="min-h-11 shrink-0 sm:min-h-8"
          onClick={() => {
            setShowForm(true);
            if (!agentId && agents[0]) setAgentId(agents[0].id);
          }}
          disabled={showForm || agents.length === 0 || Boolean(agentsError)}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          {t("common:scheduler.create")}
        </Button>
      </div>

      {agentsError && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-3"
        >
          <p className="text-xs leading-5 text-[var(--text-secondary)]">
            {t("settings:scheduler.agentsLoadFailed")}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2 min-h-11 sm:min-h-8"
            onClick={() => void fetchAgents()}
          >
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
            {t("common:buttons.retry")}
          </Button>
        </div>
      )}

      {!agentsLoading && !agentsError && agents.length === 0 && (
        <div className="mt-4 rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-4">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {t("settings:scheduler.noAgentsTitle")}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--text-tertiary)]">
            {t("settings:scheduler.noAgentsDescription")}
          </p>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mt-4 space-y-4 rounded-xl border border-[var(--accent-color)]/30 bg-[var(--accent-subtle)]/30 p-4"
        >
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
              {t("common:scheduler.agent")}
            </span>
            <Select value={agentId} onValueChange={setAgentId} disabled={isCreating}>
              <SelectTrigger
                className="min-h-11 sm:min-h-10"
                aria-label={t("common:scheduler.agent")}
              >
                <SelectValue placeholder={t("settings:scheduler.selectAgent")} />
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
              {t("common:scheduler.cron")}
            </span>
            <Input
              value={cronExpression}
              onChange={(event) => setCronExpression(event.target.value)}
              onBlur={() => {
                if (!cronExpression.trim()) setFormError(t("settings:scheduler.requiredFields"));
              }}
              disabled={isCreating}
              maxLength={120}
              spellCheck={false}
              className="min-h-11 font-mono sm:min-h-10"
              aria-describedby="scheduler-cron-help"
            />
            <p
              id="scheduler-cron-help"
              className="mt-1.5 text-xs leading-5 text-[var(--text-tertiary)]"
            >
              {t("settings:scheduler.cronHelp")}
            </p>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">
              {t("common:scheduler.prompt")}
            </span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onBlur={() => {
                if (!prompt.trim()) setFormError(t("settings:scheduler.requiredFields"));
              }}
              disabled={isCreating}
              maxLength={32_000}
              rows={4}
              placeholder={t("settings:scheduler.promptPlaceholder")}
              className="min-h-24 w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent-color)] focus:ring-2 focus:ring-[var(--accent-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          {formError && (
            <p role="alert" className="text-xs leading-5 text-[var(--status-error)]">
              {formError}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              className="min-h-11 sm:min-h-10"
              onClick={resetForm}
              disabled={isCreating}
            >
              {t("common:buttons.cancel")}
            </Button>
            <Button type="submit" className="min-h-11 sm:min-h-10" disabled={isCreating}>
              {isCreating ? t("settings:scheduler.creating") : t("settings:scheduler.createAction")}
            </Button>
          </div>
        </form>
      )}

      {loadError && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-3"
        >
          <div className="flex gap-2">
            <AlertCircle
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-error)]"
            />
            <p className="text-xs leading-5 text-[var(--text-secondary)]">
              {t("settings:scheduler.loadFailed")}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2 min-h-11 sm:min-h-8"
            onClick={() => void fetchTasks()}
          >
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
            {t("common:buttons.retry")}
          </Button>
        </div>
      )}

      {isLoading && tasks.length === 0 ? (
        <p role="status" className="py-12 text-center text-sm text-[var(--text-muted)]">
          {t("common:loading")}
        </p>
      ) : !loadError && tasks.length === 0 ? (
        <div className="py-12 text-center">
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--bg-elevated)] text-[var(--text-tertiary)]">
            <CalendarClock aria-hidden="true" className="h-5 w-5" />
          </span>
          <p className="mt-3 text-sm font-medium text-[var(--text-primary)]">
            {t("common:scheduler.empty")}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[var(--text-tertiary)]">
            {t("settings:scheduler.emptyDescription")}
          </p>
        </div>
      ) : tasks.length > 0 ? (
        <div className="mt-4 space-y-3">
          {tasks.map((task) => {
            const agent = agentsById.get(task.agentId);
            const isPending = pendingTaskId === task.id;
            return (
              <article
                key={task.id}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium text-[var(--text-primary)]">
                        {agent?.name ?? t("settings:scheduler.missingAgent")}
                      </h3>
                      {!agent && (
                        <span className="rounded-full bg-[var(--status-error)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--status-error)]">
                          {t("settings:scheduler.unavailable")}
                        </span>
                      )}
                    </div>
                    <code className="mt-1 block break-all text-xs text-[var(--accent-hover)]">
                      {task.cronExpression}
                    </code>
                    <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-[var(--text-secondary)]">
                      {task.prompt}
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-4 text-[var(--text-muted)]">
                      <span>
                        {t("settings:scheduler.nextRun")}:{" "}
                        {task.enabled && task.nextRunAt
                          ? formatTaskTime(task.nextRunAt)
                          : t("settings:scheduler.notScheduled")}
                      </span>
                      {task.lastRunAt && (
                        <span>
                          {t("settings:scheduler.lastRun")}: {formatTaskTime(task.lastRunAt)}
                          {task.lastResult === "error"
                            ? ` · ${t("settings:scheduler.lastRunError")}`
                            : ""}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={task.enabled}
                      onCheckedChange={(enabled) => void handleToggle(task, enabled)}
                      disabled={isPending || !agent}
                      className="relative h-11 w-11 border-0 bg-transparent before:absolute before:inset-x-0 before:top-2.5 before:h-6 before:rounded-full before:bg-[var(--bg-active)] data-[state=checked]:bg-transparent data-[state=checked]:before:bg-[var(--accent-color)] sm:h-6 sm:bg-[var(--bg-active)] sm:before:hidden sm:data-[state=checked]:bg-[var(--accent-color)]"
                      aria-label={t("settings:scheduler.toggleNamed", {
                        name: agent?.name ?? task.agentId,
                      })}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 text-[var(--status-error)] sm:h-9 sm:w-9"
                      onClick={() => setTaskToDelete(task)}
                      disabled={isPending}
                      aria-label={t("settings:scheduler.deleteNamed", {
                        name: agent?.name ?? task.agentId,
                      })}
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {taskErrors[task.id] && (
                  <p role="alert" className="mt-3 text-xs leading-5 text-[var(--status-error)]">
                    {taskErrors[task.id]}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(taskToDelete)}
        title={t("settings:scheduler.deleteTitle")}
        message={t("settings:scheduler.deleteMessage")}
        confirmLabel={t("common:buttons.delete")}
        confirmingLabel={t("common:buttons.deleting")}
        isConfirming={Boolean(taskToDelete && pendingTaskId === taskToDelete.id)}
        onConfirm={() => void handleDelete()}
        onCancel={() => setTaskToDelete(null)}
      />
    </>
  );
}

function omitKey(values: Record<string, string>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([entryKey]) => entryKey !== key));
}

function formatTaskTime(value: number): string {
  return new Date(value).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function readSchedulerError(error: unknown, t: (key: string) => string): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "Invalid cron expression") return t("settings:scheduler.invalidCron");
  if (message === "Agent not found") return t("settings:scheduler.agentNotFound");
  if (message === "Prompt is required") return t("settings:scheduler.promptRequired");
  return t("settings:scheduler.createFailed");
}
