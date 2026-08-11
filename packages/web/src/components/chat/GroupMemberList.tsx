import { useCallback, useEffect, useState } from "react";
import type { Agent, Conversation, RoomMember } from "@chorus/shared";
import {
  AlertCircle,
  Clock3,
  Plus,
  RefreshCw,
  User,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
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
import { useUIStore } from "@/store/uiStore";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

const LABEL_SEPARATOR = ":";

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
  const [pendingHubId, setPendingHubId] = useState<string | null>(null);
  const [invitedHubIds, setInvitedHubIds] = useState<Set<string>>(new Set());
  const [contacts, setContacts] = useState<Array<{ hubId: string; userName?: string }>>([]);
  const [canInviteContacts, setCanInviteContacts] = useState(false);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState(false);
  const [inviteContextError, setInviteContextError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<Agent | null>(null);
  const addToast = useUIStore((state) => state.addToast);

  const refreshMembers = useCallback(async () => {
    setIsLoadingMembers(true);
    setMembersError(false);
    setActionError(null);
    try {
      if (conversation.relayRoomId) {
        const room = await api.getHubRoom(conversation.relayRoomId, true);
        setHumanMembers(room.members);
        setMembers(room.agents);
        try {
          const [trust, hubConfig] = await Promise.all([
            api.getTrustList(true),
            api.getHubConfig(),
          ]);
          setContacts(trust);
          setCanInviteContacts(room.metadata?.createdByHubId === hubConfig.hubId);
          setInviteContextError(false);
        } catch (error) {
          logger.error("Failed to load Room invitation context", error);
          setCanInviteContacts(false);
          setInviteContextError(true);
        }
      } else {
        setHumanMembers([]);
        setContacts([]);
        setCanInviteContacts(false);
        setInviteContextError(false);
        setMembers(await api.getConversationMembers(conversation.id, true));
      }
    } catch (error) {
      logger.error("Failed to load group members", error);
      setMembersError(true);
    } finally {
      setIsLoadingMembers(false);
    }
  }, [conversation.id, conversation.relayRoomId]);

  useEffect(() => {
    setMembers(agents.filter((agent) => conversation.agentIds.includes(agent.id)));
    setHumanMembers([]);
    void refreshMembers();
  }, [agents, conversation.agentIds, conversation.id, refreshMembers]);

  const addMember = async (agentId: string) => {
    setPendingAgentId(agentId);
    setActionError(null);
    try {
      if (conversation.relayRoomId) {
        await api.addAgentToRoom(conversation.relayRoomId, agentId, true);
      } else {
        const updated = await api.addConversationMembers(conversation.id, [agentId], true);
        syncConversation(updated);
      }
      await refreshMembers();
      addToast(t("chat:memberAdded"), "success");
    } catch (error) {
      logger.error("Failed to add group member", error);
      setActionError(t("chat:addMemberFailed"));
    } finally {
      setPendingAgentId(null);
    }
  };

  const removeMember = async () => {
    if (!memberToRemove) return;
    const agentId = memberToRemove.id;
    setPendingAgentId(agentId);
    setActionError(null);
    try {
      if (conversation.relayRoomId) {
        await api.removeAgentFromRoom(conversation.relayRoomId, agentId, true);
        await refreshMembers();
      } else {
        const updated = await api.removeConversationMember(conversation.id, agentId, true);
        syncConversation(updated);
        setMembers((current) => current.filter((member) => member.id !== agentId));
      }
      setMemberToRemove(null);
      addToast(t("chat:memberRemoved"), "success");
    } catch (error) {
      logger.error("Failed to remove group member", error);
      setMemberToRemove(null);
      setActionError(t("chat:removeMemberFailed"));
    } finally {
      setPendingAgentId(null);
    }
  };

  const inviteContact = async (hubId: string) => {
    if (!conversation.relayRoomId) return;
    setPendingHubId(hubId);
    setActionError(null);
    try {
      await api.inviteHubToRoom(conversation.relayRoomId, hubId, true);
      setInvitedHubIds((current) => new Set(current).add(hubId));
      addToast(t("chat:roomInviteSent"), "success");
    } catch (error) {
      logger.error("Failed to invite contact to Room", error);
      setActionError(t("chat:roomInviteFailed"));
    } finally {
      setPendingHubId(null);
    }
  };

  const currentMemberIds = new Set(members.map((member) => member.id));
  const availableAgents = agents.filter(
    (agent) =>
      agent.status === "online" &&
      !agent.stale &&
      !currentMemberIds.has(agent.id) &&
      (!conversation.relayRoomId || agent.ownerType !== "remote"),
  );
  const liveMembers = members.map(
    (member) => agents.find((agent) => agent.id === member.id) ?? member,
  );
  const duplicateHubNames = new Set(
    humanMembers
      .map((member) => member.displayName)
      .filter((name, index, names) => names.indexOf(name) !== index),
  );
  const memberCount = humanMembers.length + liveMembers.length;
  const humanMemberIds = new Set(humanMembers.map((member) => member.hubId));
  const availableContacts = contacts.filter((contact) => !humanMemberIds.has(contact.hubId));

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) void refreshMembers();
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 text-xs text-[var(--text-tertiary)] outline-none hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--accent-color)] sm:mt-0.5 sm:min-h-0 sm:min-w-0 sm:justify-start sm:px-0"
          >
            <Users aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {t("common:group.memberCount", { count: memberCount })}
            </span>
            <span className="sm:hidden">{memberCount}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-96 w-[min(40rem,calc(100vw-2rem))] overflow-y-auto p-2"
        >
          <div className="px-2 pb-2 pt-1 text-sm font-semibold text-[var(--text-primary)]">
            {t("chat:members")}
          </div>
          {membersError && (
            <div
              role="alert"
              className="mb-2 rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-3"
            >
              <div className="flex gap-2">
                <AlertCircle
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-error)]"
                />
                <p className="text-xs leading-5 text-[var(--text-secondary)]">
                  {t("chat:membersLoadFailed")}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2 min-h-11 sm:min-h-8"
                onClick={() => void refreshMembers()}
              >
                <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                {t("common:buttons.retry")}
              </Button>
            </div>
          )}
          {isLoadingMembers &&
            !membersError &&
            members.length === 0 &&
            humanMembers.length === 0 && (
              <p role="status" className="px-2 py-4 text-center text-xs text-[var(--text-muted)]">
                {t("common:loading")}
              </p>
            )}
          {inviteContextError && (
            <p
              role="alert"
              className="mb-2 rounded-lg bg-[var(--status-error)]/5 px-3 py-2 text-xs leading-5 text-[var(--text-secondary)]"
            >
              {t("chat:inviteContextFailed")}
            </p>
          )}
          {actionError && (
            <p
              role="alert"
              className="mb-2 rounded-lg bg-[var(--status-error)]/5 px-3 py-2 text-xs leading-5 text-[var(--status-error)]"
            >
              {actionError}
            </p>
          )}
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
                      <User
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-[var(--text-secondary)]"
                      />
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
                {!isLoadingMembers && !membersError && humanMembers.length === 0 && (
                  <p className="px-2 py-2 text-xs text-[var(--text-muted)]">
                    {t("chat:noHumanMembers")}
                  </p>
                )}
              </div>
              {canInviteContacts && availableContacts.length > 0 && (
                <div className="mt-2 border-t border-[var(--border-color)] pt-2">
                  <div className="px-2 py-1 text-xs font-medium text-[var(--text-tertiary)]">
                    {t("chat:inviteContacts")}
                  </div>
                  <div className="space-y-1">
                    {availableContacts.map((contact) => {
                      const invited = invitedHubIds.has(contact.hubId);
                      return (
                        <button
                          key={contact.hubId}
                          type="button"
                          disabled={invited || pendingHubId === contact.hubId}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void inviteContact(contact.hubId);
                          }}
                          className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--bg-hover)] disabled:opacity-60 sm:min-h-0"
                        >
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-elevated)]">
                            <User aria-hidden="true" className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            {contact.userName ?? contact.hubId.slice(0, 10)}
                          </span>
                          {invited ? (
                            <span className="flex items-center gap-1 text-[10px] text-[var(--status-busy)]">
                              <Clock3 aria-hidden="true" className="h-3 w-3" />
                              {t("chat:awaitingAcceptance")}
                            </span>
                          ) : (
                            <UserPlus
                              aria-hidden="true"
                              className="h-3.5 w-3.5 text-[var(--accent-hover)]"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
            <DropdownMenuSeparator className="sm:hidden" />
            <section
              className="min-w-0 px-1 pt-2 sm:pl-2 sm:pt-0"
              aria-label={t("chat:agentMembers")}
            >
              <div className="px-2 py-1 text-xs font-medium text-[var(--text-tertiary)]">
                {t("chat:agentMembers")}
              </div>
              <div className="space-y-1">
                {liveMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--bg-hover)]"
                  >
                    <span className="relative shrink-0">
                      <AgentAvatar name={member.name} src={member.avatar} size="xs" />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[var(--bg-surface)] ${STATUS_COLORS[member.status]}`}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-[var(--text-primary)]">
                        {member.name}
                      </div>
                      <div className="truncate text-[10px] text-[var(--text-tertiary)]">
                        {t("chat:owner")}
                        {LABEL_SEPARATOR} {member.owner?.name ?? member.ownerId ?? "—"}
                        {" · "}
                        {t(`common:status.${member.status}`)}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 text-[var(--text-tertiary)] hover:text-[var(--status-error)] md:h-7 md:w-7"
                      disabled={pendingAgentId === member.id}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setMemberToRemove(member);
                      }}
                      aria-label={t("common:group.removeMember", { name: member.name })}
                      title={t("common:group.removeMember", { name: member.name })}
                    >
                      <UserMinus aria-hidden="true" className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                {!isLoadingMembers && !membersError && liveMembers.length === 0 && (
                  <p className="px-2 py-2 text-xs text-[var(--text-muted)]">
                    {t("chat:noAgentMembers")}
                  </p>
                )}
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
                    className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--bg-hover)] disabled:opacity-50 sm:min-h-0"
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
      <ConfirmDialog
        open={Boolean(memberToRemove)}
        title={t("chat:removeMemberTitle")}
        message={t("chat:removeMemberMessage", { name: memberToRemove?.name ?? "" })}
        confirmLabel={t("common:buttons.confirm")}
        confirmingLabel={t("chat:removingMember")}
        isConfirming={Boolean(memberToRemove && pendingAgentId === memberToRemove.id)}
        onConfirm={() => void removeMember()}
        onCancel={() => setMemberToRemove(null)}
      />
    </>
  );
}
