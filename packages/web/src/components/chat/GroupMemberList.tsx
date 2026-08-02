import { useEffect, useState } from "react";
import type { Agent, Conversation } from "@agentlink/shared";
import { Plus, UserMinus, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STATUS_COLORS } from "@/constants/agent";
import { api } from "@/services/api";
import { useAgentStore } from "@/store/agentStore";
import { useChatStore } from "@/store/chatStore";
import { logger } from "@/utils/logger";

interface GroupMemberListProps {
  conversation: Conversation;
}

export function GroupMemberList({ conversation }: GroupMemberListProps) {
  const { t } = useTranslation("common");
  const agents = useAgentStore((state) => state.agents);
  const syncConversation = useChatStore((state) => state.syncConversation);
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Agent[]>([]);
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);

  const refreshMembers = async () => {
    try {
      setMembers(await api.getConversationMembers(conversation.id));
    } catch (error) {
      logger.error("Failed to load group members", error);
    }
  };

  useEffect(() => {
    setMembers(agents.filter((agent) => conversation.agentIds.includes(agent.id)));
  }, [agents, conversation.id, conversation.agentIds]);

  const addMember = async (agentId: string) => {
    setPendingAgentId(agentId);
    try {
      const updated = await api.addConversationMembers(conversation.id, [agentId]);
      syncConversation(updated);
      await refreshMembers();
    } catch (error) {
      logger.error("Failed to add group member", error);
    } finally {
      setPendingAgentId(null);
    }
  };

  const removeMember = async (agentId: string) => {
    setPendingAgentId(agentId);
    try {
      const updated = await api.removeConversationMember(conversation.id, agentId);
      syncConversation(updated);
      setMembers((current) => current.filter((member) => member.id !== agentId));
    } catch (error) {
      logger.error("Failed to remove group member", error);
    } finally {
      setPendingAgentId(null);
    }
  };

  const currentMemberIds = new Set(members.map((member) => member.id));
  const availableAgents = agents.filter(
    (agent) => agent.status === "online" && !currentMemberIds.has(agent.id),
  );
  const liveMembers = members.map((member) =>
    agents.find((agent) => agent.id === member.id) ?? member,
  );

  return (
    <DropdownMenu open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (nextOpen) void refreshMembers();
    }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="mt-0.5 flex items-center gap-1 rounded-md text-xs text-[var(--text-tertiary)] outline-none hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--accent-color)]"
        >
          <Users aria-hidden="true" className="h-3.5 w-3.5" />
          {t("group.memberCount", { count: conversation.agentIds.length })}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-y-auto p-2">
        <div className="space-y-1">
          {liveMembers.map((member) => (
            <div key={member.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--bg-hover)]">
              <span className="relative shrink-0">
                <AgentAvatar name={member.name} src={member.avatar} size="xs" />
                <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[var(--bg-surface)] ${STATUS_COLORS[member.status]}`} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-[var(--text-primary)]">{member.name}</div>
                <div className="text-[10px] text-[var(--text-tertiary)]">
                  {t(`status.${member.status}`)}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-[var(--text-tertiary)] hover:text-[var(--status-error)]"
                disabled={pendingAgentId === member.id}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void removeMember(member.id);
                }}
                aria-label={t("group.removeMember", { name: member.name })}
                title={t("group.removeMember", { name: member.name })}
              >
                <UserMinus aria-hidden="true" className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        {availableAgents.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1 text-xs font-medium text-[var(--text-tertiary)]">
              {t("group.addMembers")}
            </div>
            <div className="space-y-1">
              {availableAgents.map((agent) => (
                <button
                  type="button"
                  key={agent.id}
                  disabled={pendingAgentId === agent.id}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void addMember(agent.id);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  <AgentAvatar name={agent.name} src={agent.avatar} size="xs" />
                  <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                  <Plus aria-hidden="true" className="h-3.5 w-3.5 text-[var(--accent-hover)]" />
                </button>
              ))}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
