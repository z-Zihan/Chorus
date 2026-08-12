import { useEffect, useMemo, useState } from "react";
import { Download, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type ServerLogEntry } from "@/services/api";
import { getDesktopLogs, getLogs, type LogLevel } from "@/utils/logger";
import { useUIStore } from "@/store/uiStore";

type LogFilter = "all" | LogLevel;
interface LogViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LogViewer({ open, onOpenChange }: LogViewerProps) {
  const { t } = useTranslation(["common", "settings"]);
  const [level, setLevel] = useState<LogFilter>("all");
  const [search, setSearch] = useState("");
  const [backendLogs, setBackendLogs] = useState<ServerLogEntry[]>([]);
  const [desktopLogs, setDesktopLogs] = useState<ServerLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const addToast = useUIStore((state) => state.addToast);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setIsLoading(true);
    setLoadFailed(false);
    void Promise.allSettled([api.getLogs(level, 2_000), getDesktopLogs(500)])
      .then(([serverResult, desktopResult]) => {
        if (!active) return;
        if (serverResult.status === "fulfilled") setBackendLogs(serverResult.value);
        else setLoadFailed(true);
        if (desktopResult.status === "fulfilled") setDesktopLogs(desktopResult.value);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [level, open]);

  const visibleLogs = useMemo(() => {
    const frontendLogs = getLogs(level === "all" ? undefined : level, 500);
    const keyword = search.trim().toLowerCase();
    const uniqueLogs = new Map<string, ServerLogEntry>();
    for (const entry of [...backendLogs, ...desktopLogs, ...frontendLogs]) {
      const key =
        entry.id ??
        `${entry.source}:${entry.timestamp}:${entry.level}:${entry.message}:${JSON.stringify(entry.data)}`;
      uniqueLogs.set(key, entry);
    }
    return [...uniqueLogs.values()]
      .sort((left, right) => left.timestamp - right.timestamp)
      .filter((entry) => {
        if (level !== "all" && entry.level !== level) return false;
        if (!keyword) return true;
        return JSON.stringify(entry).toLowerCase().includes(keyword);
      });
  }, [backendLogs, desktopLogs, level, search]);

  const exportVisibleLogs = () => {
    let url: string | null = null;
    try {
      const blob = new Blob([JSON.stringify(visibleLogs, null, 2)], { type: "application/json" });
      url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `chorus-logs-${new Date().toISOString().replaceAll(":", "-")}.json`;
      anchor.click();
    } catch {
      addToast(t("settings:logs.exportFailed"), "error");
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[85vh] max-w-4xl flex-col p-0"
      >
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <DialogTitle>{t("settings:logs.title")}</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label={t("common:buttons.close")}
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </Button>
        </div>

        <div className="grid gap-3 border-b border-[var(--border-color)] p-4 sm:grid-cols-[10rem_1fr_auto]">
          <Select value={level} onValueChange={(value: LogFilter) => setLevel(value)}>
            <SelectTrigger aria-label={t("settings:logs.levelFilter")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["all", "trace", "debug", "info", "warn", "error", "fatal"] as const).map(
                (item) => (
                  <SelectItem key={item} value={item}>
                    {t(`settings:logs.levels.${item}`)}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("settings:logs.searchPlaceholder")}
            aria-label={t("settings:logs.searchLabel")}
          />
          <Button
            variant="secondary"
            onClick={exportVisibleLogs}
            disabled={visibleLogs.length === 0}
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            {t("settings:logs.export")}
          </Button>
        </div>

        <div
          className="min-h-64 flex-1 overflow-y-auto bg-[var(--bg-base)] p-4 font-mono text-xs"
          role="log"
        >
          {isLoading && <p className="text-[var(--text-muted)]">{t("common:loading")}</p>}
          {loadFailed && (
            <p role="alert" className="mb-3 text-[var(--text-secondary)]">
              {t("settings:logs.backendUnavailable")}
            </p>
          )}
          {!isLoading && visibleLogs.length === 0 ? (
            <p className="text-[var(--text-muted)]">{t("settings:logs.empty")}</p>
          ) : (
            <ol className="space-y-2">
              {visibleLogs.map((entry, index) => (
                <li
                  key={`${entry.source}-${entry.timestamp}-${index}`}
                  className="grid gap-x-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-3 sm:grid-cols-[10.5rem_4rem_4.5rem_1fr]"
                >
                  <time className="text-[var(--text-muted)]">
                    {new Date(entry.timestamp).toLocaleString()}
                  </time>
                  <span className="uppercase text-[var(--accent-hover)]">{entry.level}</span>
                  <span className="text-[var(--text-tertiary)]">{entry.source}</span>
                  <span className="min-w-0 break-words text-[var(--text-primary)]">
                    {entry.message}
                    {entry.data !== undefined && (
                      <span className="mt-1 block whitespace-pre-wrap text-[var(--text-secondary)]">
                        {JSON.stringify(entry.data, null, 2)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
