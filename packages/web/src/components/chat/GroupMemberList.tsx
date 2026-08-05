import { useCallback, useEffect, useState } from "react";
import type { Agent, Conversation, RoomMember } from "@agentlink/shared";
import { Plus, User, UserMinus, Users } from "lucide-react";
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
  const { t } = useTranslation(["common", "chat"]);
  const agents = useAgentStore((state) => state.agents);
  const syncConversation = useChatStore((state) => state.syncConversation);
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Agent[]>([]);
  const [humanMembers, setHumanMembers] = useState<RoomMember[]>([]);
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);

  const refreshMembers = useCallback(async () => {
    try {
      if (conversation.relayRoomId) {
        const room = await api.getHubRoom(conversation.relayRoomId);
        setHumanMembers(room.members);
        setMembers(room.agents);
      } else {
        setHumanMembers([]);
        setMembers(await api.getConversationMembers(conversation.id));
      }
    } catch (error) {
      logger.error("Failed to load group members", error);
    }
  }, [conversation.id, conversation.relayRoomId]);

  useEffect(() => {
    setMembers(agents.filter((agent) => conversation.agentIds.includes(agent.id)));
    setHumanMembers([]);
    void refreshMembers();
  }, [conversation.id, refreshMembers]);

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
  const duplicateHubNames = new Set(
    humanMembers
      .map((member) => member.displayName)
      .filter((name, index, names) => names.indexOf(name) !== index),
  );
  const memberCount = humanMembers.length + liveMembers.length;

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
          {t("common:group.memberCount", { count: memberCount })}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-96 w-[min(40rem,calc(100vw-2rem))] overflow-y-auto p-2"
      >
        <div className="px-2 pb-2 pt-1 text-sm font-semibold text-[var(--text-primary)]">
          {t("chat:members")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 sm:divide-x sm:divide-[var(--border-color)]">
          <section className="min-w-0 px-1 pb-2 sm:pr-2" aria-label={t("chat:humanMembers")}>
            <div className="px-2 py-1 text-xs font-medium text-[var(--text-tertiary)]">
              {t("chat:humanMembers")}
            </div>
            <div className="space-y-1">
              {humanMembers.map((member) => (
                <div
                  key={member.hubId}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--bg-hover)]"
                >
                  <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-elevated)]">
                    <User aria-hidden="true" className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[var(--bg-surface)] ${STATUS_COLORS[member.online ? "online" : "offline"]}`}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-[var(--text-primary)]">
                      {member.displayName}
                      {duplicateHubNames.has(member.displayName) && (
                        <span className="ml-1 font-mono text-[10px] text-[var(--text-tertiary)]">
                          {member.hubId.slice(0, 8)}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-[var(--text-tertiary)]">
                      {t(`common:status.${member.online ? "online" : "offline"}`)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <DropdownMenuSeparator className="sm:hidden" />
          <section className="min-w-0 px-1 pt-2 sm:pl-2 sm:pt-0" aria-label={t("chat:agentMembers")}>
            <div className="px-2 py-1 text-xs font-medium text-[var(--text-tertiary)]">
              {t("chat:agentMembers")}
            </div>
            <div className="space-y-1">
              {liveMembers.map((member) => (
                <div key={member.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--bg-hover)]">
                  <span className="relative shrink-0">
                    <AgentAvatar name={member.name} src={member.avatar} size="xs" />
                    <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[var(--bg-surface)] ${STATUS_COLORS[member.status]}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-[var(--text-primary)]">{member.name}</div>
                    <div className="truncate text-[10px] text-[var(--text-tertiary)]">
                      {t("chat:owner")}: {member.owner?.name ?? member.ownerId ?? "—"}
                      {" · "}
                      {t(`common:status.${member.status}`)}
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
                    aria-label={t("common:group.removeMember", { name: member.name })}
                    title={t("common:group.removeMember", { name: member.name })}
                  >
                    <UserMinus aria-hidden="true" className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </section>
        </div>
        {availableAgents.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1 text-xs font-medium text-[var(--text-tertiary)]">
              {t("common:group.addMembers")}
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
