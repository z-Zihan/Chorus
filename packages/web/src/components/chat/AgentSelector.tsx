import { useRef, useState } from "react";
import { AtSign, Check, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { STATUS_COLORS } from "@/constants/agent";
import { useAgentStore } from "@/store/agentStore";

interface AgentSelectorProps {
  agentIds: string[];
  isGroup: boolean;
  value: string[];
  onValueChange: (agentIds: string[]) => void;
  disabled?: boolean;
}

export function AgentSelector({
  agentIds,
  value,
  onValueChange,
  disabled = false,
}: AgentSelectorProps) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const agents = useAgentStore((state) => state.agents);
  const eligibleAgentIds = new Set(agentIds);
  const selectableAgents = agents.filter(
    (agent) =>
      eligibleAgentIds.has(agent.id) &&
      (agent.ownerType === "remote" || agent.status === "online" || agent.status === "busy"),
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredAgents = selectableAgents.filter(
    (agent) =>
      agent.name.toLocaleLowerCase().includes(normalizedQuery) ||
      agent.id.toLocaleLowerCase().includes(normalizedQuery) ||
      agent.owner?.name.toLocaleLowerCase().includes(normalizedQuery) ||
      agent.homeHubId?.toLocaleLowerCase().includes(normalizedQuery),
  );
  const selectedAgents = agents.filter(
    (agent) => eligibleAgentIds.has(agent.id) && value.includes(agent.id),
  );
  const visibleSelectedAgents = selectedAgents.slice(0, 3);
  const hiddenSelectedCount = Math.max(0, selectedAgents.length - visibleSelectedAgents.length);

  const toggleAgent = (agentId: string) => {
    if (agents.find((agent) => agent.id === agentId)?.stale) return;
    onValueChange(
      value.includes(agentId)
        ? value.filter((selectedId) => selectedId !== agentId)
        : [...value, agentId],
    );
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) requestAnimationFrame(() => searchRef.current?.focus());
        else setQuery("");
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={t("agentSelector.label")}
          className="h-8 max-w-52 shrink-0 gap-1.5 px-2"
        >
          {selectedAgents.length > 0 ? (
            <span className="flex shrink-0 items-center -space-x-1.5" aria-hidden="true">
              {visibleSelectedAgents.map((agent) => (
                <span key={agent.id} className="rounded-full ring-2 ring-[var(--bg-surface)]">
                  <AgentAvatar name={agent.name} src={agent.avatar} size="xs" />
                </span>
              ))}
              {hiddenSelectedCount > 0 && (
                <span className="relative flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--bg-elevated)] px-1 text-[10px] font-medium text-[var(--text-secondary)] ring-2 ring-[var(--bg-surface)]">
                  +{hiddenSelectedCount}
                </span>
              )}
            </span>
          ) : (
            <AtSign aria-hidden="true" className="h-4 w-4" />
          )}
          <span className="truncate">
            {selectedAgents.length === 0
              ? t("agentSelector.selectAgents")
              : selectedAgents.length === 1
                ? selectedAgents[0].name
                : t("agentSelector.agentsSelected", { count: selectedAgents.length })}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
        <div
          className="relative p-1"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const index = event.key === "ArrowDown" ? 0 : filteredAgents.length - 1;
              itemRefs.current[index]?.focus();
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (filteredAgents[0]) toggleAgent(filteredAgents[0].id);
            }
          }}
        >
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--text-tertiary)]"
          />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("agentSelector.search")}
            aria-label={t("agentSelector.search")}
            className="h-8 pl-8"
          />
        </div>
        <DropdownMenuSeparator />
        {filteredAgents.map((agent, index) => (
          <DropdownMenuItem
            key={agent.id}
            disabled={agent.stale}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            onSelect={(event) => {
              event.preventDefault();
              toggleAgent(agent.id);
            }}
            aria-checked={value.includes(agent.id)}
            role="menuitemcheckbox"
            className={agent.stale ? "opacity-50 grayscale" : undefined}
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                value.includes(agent.id)
                  ? "border-teal-500 bg-teal-500 text-white"
                  : "border-[var(--border-color)] bg-[var(--bg-base)]"
              }`}
            >
              {value.includes(agent.id) && <Check aria-hidden="true" className="h-3 w-3" />}
            </span>
            <span className="relative shrink-0">
              <AgentAvatar name={agent.name} src={agent.avatar} size="xs" />
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[var(--bg-surface)] ${agent.stale ? "bg-gray-400" : STATUS_COLORS[agent.status]}`}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{agent.name}</span>
              {agent.ownerType === "remote" && (
                <span className="block truncate text-[10px] text-[var(--text-tertiary)]">
                  {t("owner")}: {agent.owner?.name ?? agent.ownerId ?? "—"} · {agent.homeHubId ?? "—"}
                </span>
              )}
            </span>
            {agent.ownerType === "remote" && (
              <span className="shrink-0 rounded bg-blue-500/15 px-1 py-0.5 text-[9px] text-blue-600 dark:text-blue-300">
                {t("remoteAgent")}
              </span>
            )}
          </DropdownMenuItem>
        ))}
        {filteredAgents.length === 0 && (
          <p className="px-3 py-2 text-sm text-[var(--text-muted)]">
            {t("agentSelector.noAgents")}
          </p>
        )}
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between gap-3 px-2 py-1">
          <span className="text-xs text-[var(--text-muted)]">
            {t("agentSelector.selectedCount", { count: selectedAgents.length })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={selectedAgents.length === 0}
            className="h-7 px-2 text-xs text-teal-600 dark:text-teal-400"
            onClick={() => onValueChange([])}
          >
            {t("agentSelector.clearSelection")}
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
