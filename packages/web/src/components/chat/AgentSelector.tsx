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
  value: string | null;
  onValueChange: (agentId: string | null) => void;
  disabled?: boolean;
}

export function AgentSelector({
  agentIds,
  isGroup,
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
  const onlineAgents = agents.filter(
    (agent) => eligibleAgentIds.has(agent.id) && agent.status === "online",
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredAgents = onlineAgents.filter((agent) =>
    agent.name.toLocaleLowerCase().includes(normalizedQuery)
    || agent.id.toLocaleLowerCase().includes(normalizedQuery)
  );
  const selectedAgent = onlineAgents.find((agent) => agent.id === value)
    ?? (!isGroup ? onlineAgents[0] : undefined);

  const select = (agentId: string | null) => {
    onValueChange(agentId);
    setQuery("");
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (nextOpen) requestAnimationFrame(() => searchRef.current?.focus());
      else setQuery("");
    }}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={t("agentSelector.label")}
          className="h-8 max-w-40 shrink-0 px-2"
        >
          <AtSign aria-hidden="true" className="h-4 w-4" />
          <span className="truncate">{selectedAgent?.name ?? t("agentSelector.all")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        className="w-64"
      >
        <div className="relative p-1" onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const index = event.key === "ArrowDown" ? 0 : filteredAgents.length;
            itemRefs.current[index]?.focus();
          } else if (event.key === "Enter") {
            event.preventDefault();
            select(filteredAgents[0]?.id ?? null);
          }
        }}>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[var(--text-tertiary)]" />
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
        {isGroup && (
          <DropdownMenuItem
            ref={(element) => { itemRefs.current[filteredAgents.length] = element; }}
            onSelect={() => select(null)}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-elevated)]">
              <AtSign aria-hidden="true" className="h-3.5 w-3.5" />
            </span>
            <span className="flex-1">{t("agentSelector.allAgents")}</span>
            {value === null && <Check aria-hidden="true" className="h-4 w-4" />}
          </DropdownMenuItem>
        )}
        {filteredAgents.map((agent, index) => (
          <DropdownMenuItem
            key={agent.id}
            ref={(element) => { itemRefs.current[index] = element; }}
            onSelect={() => select(agent.id)}
          >
            <span className="relative shrink-0">
              <AgentAvatar name={agent.name} src={agent.avatar} size="xs" />
              <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[var(--bg-surface)] ${STATUS_COLORS[agent.status]}`} />
            </span>
            <span className="min-w-0 flex-1 truncate">{agent.name}</span>
            {value === agent.id && <Check aria-hidden="true" className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
        {filteredAgents.length === 0 && (
          <p className="px-3 py-2 text-sm text-[var(--text-muted)]">{t("agentSelector.noAgents")}</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
