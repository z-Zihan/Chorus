import { useEffect, useMemo, useState } from "react";
import { CalendarDays, LoaderCircle, Search, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAgentStore } from "@/store/agentStore";
import { useChatStore } from "@/store/chatStore";
import { useSearchStore } from "@/store/searchStore";
import type { MessageSearchResult } from "@/services/api";

interface SearchPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchPanel({ open, onOpenChange }: SearchPanelProps) {
  const { t, i18n } = useTranslation("common");
  const query = useSearchStore((state) => state.query);
  const results = useSearchStore((state) => state.results);
  const isSearching = useSearchStore((state) => state.isSearching);
  const filters = useSearchStore((state) => state.filters);
  const setQuery = useSearchStore((state) => state.setQuery);
  const setFilters = useSearchStore((state) => state.setFilters);
  const searchMessages = useSearchStore((state) => state.search);
  const clearResults = useSearchStore((state) => state.clearResults);
  const navigateToMessage = useChatStore((state) => state.navigateToMessage);
  const agents = useAgentStore((state) => state.agents);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void searchMessages(query), 300);
    return () => window.clearTimeout(timer);
  }, [open, query, filters, searchMessages]);

  const groupedResults = useMemo(() => {
    const groups = new Map<string, MessageSearchResult[]>();
    for (const result of results) {
      const group = groups.get(result.conversation.id) ?? [];
      group.push(result);
      groups.set(result.conversation.id, group);
    }
    return [...groups.values()];
  }, [results]);

  const close = () => {
    clearResults();
    onOpenChange(false);
  };

  const handleResultClick = (result: MessageSearchResult) => {
    navigateToMessage(result.conversation.id, result.message.id);
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? onOpenChange(true) : close()}>
      <DialogContent className="top-[10vh] max-h-[80vh] max-w-3xl -translate-y-0 overflow-hidden p-0">
        <div className="border-b border-[var(--border-color)] p-4">
          <DialogTitle>{t("search.title")}</DialogTitle>
          <DialogDescription className="mt-1">{t("search.description")}</DialogDescription>
          <div className="relative mt-4">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("search.placeholder")}
              className="pl-9 pr-10"
            />
            {isSearching && (
              <LoaderCircle aria-label={t("search.searching")} className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--accent-hover)]" />
            )}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Select
              value={filters.agentId ?? "all"}
              onValueChange={(value) => setFilters({ agentId: value === "all" ? undefined : value })}
            >
              <SelectTrigger className="h-9">
                <UserRound aria-hidden="true" className="mr-2 h-4 w-4 text-[var(--text-tertiary)]" />
                <SelectValue placeholder={t("search.allAgents")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("search.allAgents")}</SelectItem>
                {agents.map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <label className="relative">
              <span className="sr-only">{t("search.startDate")}</span>
              <CalendarDays aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <Input
                type="date"
                value={startDate}
                aria-label={t("search.startDate")}
                onChange={(event) => {
                  const value = event.target.value;
                  setStartDate(value);
                  setFilters({ startDate: value ? new Date(`${value}T00:00:00`).getTime() : undefined });
                }}
                className="h-9 pl-9"
              />
            </label>
            <label className="relative">
              <span className="sr-only">{t("search.endDate")}</span>
              <CalendarDays aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <Input
                type="date"
                value={endDate}
                aria-label={t("search.endDate")}
                onChange={(event) => {
                  const value = event.target.value;
                  setEndDate(value);
                  setFilters({ endDate: value ? new Date(`${value}T23:59:59.999`).getTime() : undefined });
                }}
                className="h-9 pl-9"
              />
            </label>
          </div>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-3">
          {!query.trim() ? (
            <p className="px-3 py-10 text-center text-sm text-[var(--text-muted)]">{t("search.hint")}</p>
          ) : !isSearching && results.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-[var(--text-muted)]">{t("search.noResults")}</p>
          ) : (
            <div className="space-y-4">
              {groupedResults.map((group) => (
                <section key={group[0].conversation.id}>
                  <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                    {group[0].conversation.title}
                  </h3>
                  <div className="space-y-1">
                    {group.map((result) => (
                      <button
                        key={result.message.id}
                        type="button"
                        onClick={() => handleResultClick(result)}
                        className="w-full rounded-lg px-3 py-2 text-left outline-none transition-colors hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent-color)]"
                      >
                        <div className="line-clamp-2 text-sm text-[var(--text-primary)]">{result.message.content}</div>
                        <div className="mt-1 text-xs text-[var(--text-tertiary)]">
                          {new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(result.message.timestamp)}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
