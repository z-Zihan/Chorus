import { useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  Ellipsis,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { useChatStore, type Conversation } from "@/store/chatStore";
import { useAgentStore, type AgentGroup } from "@/store/agentStore";
import { useUIStore } from "@/store/uiStore";
import {
  AgentAvatar } from "@/components/agent/AgentAvatar";
import {
  AgentHealthBadge } from "@/components/agent/AgentHealthBadge";
import {
  ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
  Button } from "@/components/ui/button";
import {
  
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  STATUS_COLORS } from "@/constants/agent";
import {
  formatConversationTime } from "@/lib/date";
import {
  useHotkey } from "@/hooks/useHotkey";
import {
  useOnboardingStore } from "@/store/onboardingStore";
import {
  CatalogModal } from "@/components/catalog/CatalogModal";

interface SidebarProps {
  onOpenSettings: () => void;
}

const LAST_GROUP_AGENTS_KEY = "agentlink-last-group-agents";

function readLastGroupAgentIds(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_GROUP_AGENTS_KEY) ?? "[]") as unknown;
    return new Set(
      Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function writeLastGroupAgentIds(agentIds: string[]): void {
  try {
    localStorage.setItem(LAST_GROUP_AGENTS_KEY, JSON.stringify(agentIds));
  } catch {
    // Group creation remains available when storage is unavailable.
  }
}

export function Sidebar({ onOpenSettings }: SidebarProps) {
  const { t } = useTranslation(["common", "sidebar", "chat"]);
  const [conversationToDelete, setConversationToDelete] = useState<Conversation | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [isArchivedOpen, setIsArchivedOpen] = useState(false);
  const [isGroupsOpen, setIsGroupsOpen] = useState(true);
  const [collapsedAgentIds, setCollapsedAgentIds] = useState<Set<string>>(new Set());
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAddFriendOpen, setIsAddFriendOpen] = useState(false);
  const [remoteHubId, setRemoteHubId] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);
  const [collapsedOwnerIds, setCollapsedOwnerIds] = useState<Set<string>>(new Set());
  const [agentGroups, setAgentGroups] = useState<AgentGroup[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [selectedGroupAgentIds, setSelectedGroupAgentIds] = useState<Set<string>>(new Set());
  const conversations = useChatStore((s) => s.conversations);
  const groupConversations = useChatStore((s) => s.groupConversations);
  const archivedConversations = useChatStore((s) => s.archivedConversations);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const setCurrentConversation = useChatStore((s) => s.setCurrentConversation);
  const createConversation = useChatStore((s) => s.createConversation);
  const createGroupConversation = useChatStore((s) => s.createGroupConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const togglePin = useChatStore((s) => s.togglePin);
  const toggleArchive = useChatStore((s) => s.toggleArchive);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const agents = useAgentStore((s) => s.agents);
  const fetchGroupedAgents = useAgentStore((s) => s.fetchGroupedAgents);
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
  const closeSidebar = useUIStore((s) => s.closeSidebar);
  const allConversations = [...conversations, ...groupConversations, ...archivedConversations];
  const selectedGroupContainsRemote = agents.some(
    (agent) => selectedGroupAgentIds.has(agent.id) && agent.ownerType === "remote",
  );
  useEffect(() => {
    void fetchGroupedAgents().then(setAgentGroups).catch(() => {});
  }, [agents, fetchGroupedAgents]);

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const matchesSearch = (conversation: Conversation) =>
    !normalizedSearch || conversation.title.toLocaleLowerCase().includes(normalizedSearch);
  const visibleGroupConversations = groupConversations.filter(matchesSearch);
  const visibleArchivedConversations = archivedConversations.filter(matchesSearch);
  const handleSelectConversation = (id: string) => {
    setCurrentConversation(id);
    closeSidebar();
  };

  const toggleSidebarCollapse = () => {
    setIsSidebarCollapsed((collapsed) => !collapsed);
  };

  const handlePairFriend = async () => {
    const hubId = remoteHubId.trim();
    if (!hubId) return;

    setIsPairing(true);
    setPairingCode(null);
    setPairingError(null);
    try {
      const response = await fetch("/api/trust/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hubId }),
      });
      const result = await response.json() as { code?: string; error?: string; message?: string };
      if (!response.ok || !result.code) {
        throw new Error(result.error ?? result.message ?? "发送配对请求失败");
      }
      setPairingCode(result.code);
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : "发送配对请求失败");
    } finally {
      setIsPairing(false);
    }
  };

  const handleCreateConversation = async (agentId?: string) => {
    await createConversation(undefined, agentId);
    closeSidebar();
  };

  const handleCreateGroup = async () => {
    const selectedAgents = agents.filter((agent) => selectedGroupAgentIds.has(agent.id));
    if (selectedAgents.length < 2) return;
    setIsCreatingGroup(true);
    await createGroupConversation(
      selectedAgents
        .map((agent) => agent.name)
        .join(", ")
        .slice(0, 120),
      selectedAgents.map((agent) => agent.id),
    );
    writeLastGroupAgentIds(selectedAgents.map((agent) => agent.id));
    setIsCreatingGroup(false);
    setSelectedGroupAgentIds(new Set());
    setIsCreateGroupOpen(false);
    closeSidebar();
  };

  const openCreateGroupDialog = () => {
    const selectableAgentIds = new Set(
      agents
        .filter(
          (agent) =>
            !agent.stale && (agent.status === "online" || agent.ownerType === "remote"),
        )
        .map((agent) => agent.id),
    );
    setSelectedGroupAgentIds(
      new Set([...readLastGroupAgentIds()].filter((agentId) => selectableAgentIds.has(agentId))),
    );
    setIsCreateGroupOpen(true);
  };

  useHotkey("Ctrl+N", () => void handleCreateConversation(), [createConversation, closeSidebar]);

  const handleConfirmDelete = async () => {
    if (!conversationToDelete) return;
    setIsDeleting(true);
    const deleted = await deleteConversation(conversationToDelete.id);
    setIsDeleting(false);
    if (deleted) setConversationToDelete(null);
  };

  const startRename = (conversation: Conversation) => {
    setEditingId(conversation.id);
    setEditingTitle(conversation.title);
    setOpenMenuId(null);
  };

  const commitRename = async () => {
    if (!editingId) return;
    const conversation = allConversations.find((item) => item.id === editingId);
    const title = editingTitle.trim();
    setEditingId(null);
    if (title && title !== conversation?.title) await renameConversation(editingId, title);
  };


  const toggleAgent = (agentId: string) => {
    setCollapsedAgentIds((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  const renderConversation = (conv: Conversation, nested = false) => {
    const conversationAgent = agents.find((agent) => agent.id === conv.agentIds[0]);
    const isAgentOffline = conv.type === "dm" && conversationAgent?.status === "offline";

    return (
      <div
        key={conv.id}
        onContextMenu={(event) => {
          
          event.preventDefault();
          setOpenMenuId(conv.id);
        }}
        className={`group relative flex items-center transition-colors ${nested ? "ml-5 border-l border-[var(--border-color)] pl-1" : "rounded-lg"} ${
          currentConversationId === conv.id
            ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        }`}
      >
        <button
          type="button"
          onClick={() => handleSelectConversation(conv.id)}
          className={`flex min-w-0 flex-1 items-center text-left ${nested ? "gap-2 px-2 py-1.5" : "gap-3 px-3 py-2.5"}`}
        >
          {!nested && conv.type === "dm" ? (
            <AgentAvatar
              name={conversationAgent?.name ?? conv.title ?? t("sidebar:untitledConversation")}
              src={conversationAgent?.avatar}
              size="sm"
            />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-sm">
              <Users aria-hidden="true" className="h-4 w-4" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {conv.pinned && (
                <Pin
                  aria-label={t("sidebar:pinned")}
                  className="h-3 w-3 shrink-0 text-[var(--accent-hover)]"
                />
              )}
              <div
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  startRename(conv);
                }}
                className={`truncate font-medium ${nested ? "text-[13px]" : "text-sm"}`}
              >
                {conv.title || t("sidebar:untitledConversation")}
              </div>
              {conv.type === "cross_hub" && (
                <span className="shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-300">
                  {t("chat:crossHub")}
                </span>
              )}
              {isAgentOffline && (
                <span className="shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)] ring-1 ring-[var(--border-color)]">
                  {t("common:status.offline")}
                </span>
              )}
            </div>
            <div className="truncate text-xs text-[var(--text-muted)]">
              {formatConversationTime(conv.updatedAt)}
            </div>
          </div>
        </button>

        {editingId === conv.id && (
          <Input
            autoFocus
            value={editingTitle}
            maxLength={120}
            onChange={(event) => setEditingTitle(event.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setEditingId(null);
            }}
            onClick={(event) => event.stopPropagation()}
            aria-label={t("sidebar:renameConversation")}
            className={`absolute ${nested ? "left-8 top-1" : "left-14 top-2"} right-9 h-8 bg-[var(--bg-base)]`}
          />
        )}

        <DropdownMenu
          open={openMenuId === conv.id}
          onOpenChange={(open) => setOpenMenuId(open ? conv.id : null)}
        >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("sidebar:conversationActions", { title: conv.title })}
                className={`${nested ? "mr-1 p-1" : "mr-2 p-1.5"} rounded-md text-[var(--text-tertiary)] opacity-100 outline-none transition hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--accent-color)] md:opacity-0 md:group-hover:opacity-100 md:data-[state=open]:opacity-100`}
              >
                <Ellipsis aria-hidden="true" className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => startRename(conv)}>
                <Pencil aria-hidden="true" className="h-4 w-4" />
                {t("sidebar:rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void togglePin(conv.id)}>
                {conv.pinned ? (
                  <PinOff aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Pin aria-hidden="true" className="h-4 w-4" />
                )}
                {t(conv.pinned ? "sidebar:unpin" : "sidebar:pin")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void toggleArchive(conv.id)}>
                {conv.archived ? (
                  <ArchiveRestore aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <Archive aria-hidden="true" className="h-4 w-4" />
                )}
                {t(conv.archived ? "sidebar:unarchive" : "sidebar:archive")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setConversationToDelete(conv)}
                className="text-red-500 data-[highlighted]:text-red-400"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
                {t("sidebar:deleteConversation")}
              </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <>
      {isSidebarCollapsed && (
        <button
          type="button"
          onClick={toggleSidebarCollapse}
          aria-label={t("sidebar:expand")}
          title={t("sidebar:expand")}
          className="fixed left-0 top-0 z-30 hidden h-14 w-10 items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] md:flex"
        >
          <PanelLeftOpen aria-hidden="true" className="h-5 w-5" />
        </button>
      )}
      <aside
        className={`absolute inset-y-0 left-0 z-30 flex h-full w-72 max-w-[85vw] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-surface)] shadow-2xl transition-[transform,width] duration-200 md:static md:max-w-none md:translate-x-0 md:shadow-none ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"} ${isSidebarCollapsed ? "md:w-0 md:overflow-hidden md:border-r-0" : ""}`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-[var(--border-color)] px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-color)] text-sm font-bold text-white">
            AL
          </div>
          <span className="flex-1 font-semibold text-[var(--text-primary)]">
            {t("common:appName")}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsCatalogOpen(true)}
            aria-label={t("common:catalog.addAgent")}
            title={t("common:catalog.addAgent")}
            className="h-8 w-8"
          >
            <Users aria-hidden="true" className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void handleCreateConversation()}
            aria-label={t("sidebar:createConversation")}
            title={t("sidebar:createConversation")}
            className="h-8 w-8"
          >
            <Plus aria-hidden="true" className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsAddFriendOpen(true)}
            aria-label={t("sidebar:addFriend")}
            title={t("sidebar:addFriend")}
            className="h-8 w-8"
          >
            <UserPlus aria-hidden="true" className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebarCollapse}
            aria-label={t("common:aria.closeSidebar")}
            title={t("common:aria.closeSidebar")}
            className="hidden h-8 w-8 md:flex"
          >
            <PanelLeftClose aria-hidden="true" className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={closeSidebar}
            aria-label={t("common:aria.closeSidebar")}
            className="h-8 w-8 md:hidden"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </Button>
        </div>

        <div className="border-b border-[var(--border-color)] px-3 py-2.5">
          <label className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-2 focus-within:border-[var(--accent-color)]">
            <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("sidebar:searchConversations")}
              aria-label={t("sidebar:searchConversations")}
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
            />
          </label>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">

          <div className="space-y-3">
            {agents.length === 0 && (
              <div className="rounded-lg border border-dashed border-[var(--border-color)] px-4 py-5 text-center">
                <p className="text-sm text-[var(--text-muted)]">{t("sidebar:noAgents")}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => useOnboardingStore.getState().rescan()}
                >
                  <Search aria-hidden="true" className="h-4 w-4" />
                  {t("common:onboarding.rescan")}
                </Button>
              </div>
            )}
            {(() => {
              const allAgentIds = new Set(agents.map((a) => a.id));
              const groupsWithConversations = agentGroups
                .map((group) => ({
                  ...group,
                  agents: group.agents
                    .filter((a) => allAgentIds.has(a.id))
                    .map((a) => ({
                      agent: a,
                      conversations: conversations.filter(
                        (c) => c.agentIds.includes(a.id) &&
                          (!normalizedSearch || a.name.toLocaleLowerCase().includes(normalizedSearch) ||
                           c.title.toLocaleLowerCase().includes(normalizedSearch)),
                      ),
                      agentMatchesSearch: a.name.toLocaleLowerCase().includes(normalizedSearch),
                    }))
                    .filter(({ conversations: cs, agentMatchesSearch: ams }) =>
                      !normalizedSearch || ams || cs.length > 0,
                    ),
                }))
                .filter((group) => group.agents.length > 0);

              if (agents.length === 0) return null;

              return groupsWithConversations.map((group) => {
                const isOwnerOpen = !collapsedOwnerIds.has(group.user.id);
                const isLocal = group.user.kind === "local";
                const ownerLabel = isLocal ? t("sidebar:myAgents") : group.user.name;
                const hasNameConflict = groupsWithConversations
                  .flatMap((g) => g.agents)
                  .some((a) => a.agent.name !== group.agents[0]?.agent.name &&
                    group.agents.some((ga) => ga.agent.name === a.agent.name && ga.agent.ownerId !== group.user.id));

                return (
                  <section key={group.user.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedOwnerIds((current) => {
                          const next = new Set(current);
                          if (next.has(group.user.id)) next.delete(group.user.id);
                          else next.add(group.user.id);
                          return next;
                        })
                      }
                      aria-expanded={isOwnerOpen}
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
                    >
                      <ChevronDown
                        aria-hidden="true"
                        className={`h-3 w-3 shrink-0 transition-transform ${isOwnerOpen ? "" : "-rotate-90"}`}
                      />
                      <span className="flex-1 text-left truncate">{ownerLabel}</span>
                      {!isLocal && (
                        <span className="rounded bg-[var(--bg-elevated)] px-1 py-0.5 text-[10px] text-[var(--text-tertiary)]">
                          {t("common:hub.remote")}
                        </span>
                      )}
                      <span className="text-[10px]">{group.agents.length}</span>
                    </button>
                    {isOwnerOpen && (
                      <div className="mt-0.5 space-y-3">
                        {group.agents.map(({ agent, conversations: agentConversations }) => {
                          const isOpen = !collapsedAgentIds.has(agent.id);
                          const showOwner = !isLocal && hasNameConflict;
                          return (
                            <div key={agent.id} className="pl-2">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => toggleAgent(agent.id)}
                                  aria-expanded={isOpen}
                                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
                                >
                                  <ChevronDown
                                    aria-hidden="true"
                                    className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? "" : "-rotate-90"}`}
                                  />
                                  <span className="relative shrink-0">
                                    <AgentAvatar name={agent.name} src={agent.avatar} size="xs" />
                                    <span
                                      aria-label={t(`common:status.${agent.status}`)}
                                      className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-surface)] ${agent.stale ? "bg-gray-400" : STATUS_COLORS[agent.status]}`}
                                    />
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                                    {showOwner ? `${group.user.name} / ${agent.name}` : agent.name}
                                    {agent.stale && (
                                      <span className="ml-1 text-[10px] text-[var(--text-tertiary)] line-through">
                                        {t("common:status.offline")}
                                      </span>
                                    )}
                                  </span>
                                  <AgentHealthBadge agentId={agent.id} />
                                  <span className="min-w-5 rounded-full bg-[var(--bg-elevated)] px-1.5 py-0.5 text-center text-[10px] text-[var(--text-tertiary)]">
                                    {agentConversations.length}
                                  </span>
                                </button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 shrink-0"
                                  onClick={() => void handleCreateConversation(agent.id)}
                                  aria-label={t("sidebar:newChatWithAgent", { name: agent.name })}
                                  title={t("sidebar:newChatWithAgent", { name: agent.name })}
                                >
                                  <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                              {isOpen && (
                                <div className="mt-0.5 space-y-0.5">
                                  {agentConversations.map((conversation) =>
                                    renderConversation(conversation, true),
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              });
            })()}
          </div>

          <div className="mt-4 border-t border-[var(--border-color)] pt-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setIsGroupsOpen((open) => !open)}
                aria-expanded={isGroupsOpen}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <Users aria-hidden="true" className="h-3.5 w-3.5" />
                <span className="flex-1 text-left">{t("sidebar:groupConversations")}</span>
                <span>{visibleGroupConversations.length}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 transition-transform ${isGroupsOpen ? "rotate-180" : ""}`}
                />
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={openCreateGroupDialog}
                aria-label={t("common:group.createGroup")}
                title={t("common:group.createGroup")}
              >
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              </Button>
            </div>
            {isGroupsOpen && (
              <div className="mt-1 space-y-1">
                {visibleGroupConversations.map((conversation) => renderConversation(conversation))}
              </div>
            )}
          </div>

          {visibleArchivedConversations.length > 0 && (
            <div className="mt-4 border-t border-[var(--border-color)] pt-2">
              <button
                type="button"
                onClick={() => setIsArchivedOpen((open) => !open)}
                aria-expanded={isArchivedOpen}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                <Archive aria-hidden="true" className="h-3.5 w-3.5" />
                <span className="flex-1 text-left">{t("sidebar:archived")}</span>
                <span>{visibleArchivedConversations.length}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 transition-transform ${isArchivedOpen ? "rotate-180" : ""}`}
                />
              </button>
              {isArchivedOpen && (
                <div className="mt-1 space-y-1">
                  {visibleArchivedConversations.map((conversation) =>
                    renderConversation(conversation),
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border-color)] px-2 py-3">
          <Button variant="ghost" className="w-full justify-start" onClick={onOpenSettings}>
            <Settings aria-hidden="true" className="h-4 w-4" />
            {t("common:settings.title")}
          </Button>
        </div>
      </aside>

      <ConfirmDialog
        open={Boolean(conversationToDelete)}
        title={t("sidebar:deleteDialogTitle")}
        message={
          <Trans
            i18nKey="sidebar:deleteDialogMessage"
            values={{ title: conversationToDelete?.title || t("sidebar:untitledConversation") }}
          />
        }
        confirmLabel={t("common:buttons.delete")}
        isConfirming={isDeleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setConversationToDelete(null)}
      />

      <Dialog
        open={isCreateGroupOpen}
        onOpenChange={(open) => {
          if (open) openCreateGroupDialog();
          else {
            setIsCreateGroupOpen(false);
            if (!isCreatingGroup) setSelectedGroupAgentIds(new Set());
          }
        }}
      >
        <DialogContent>
          <DialogTitle className="flex items-center gap-2">
            {t("common:group.createGroupTitle")}
            {selectedGroupContainsRemote && (
              <span
                title={t("sidebar:crossHubGroup")}
                className="rounded bg-blue-500/15 px-1.5 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-300"
              >
                [{t("chat:crossHub")}]
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="mt-1">{t("common:group.selectAgents")}</DialogDescription>
          <div className="mt-4 max-h-72 space-y-1 overflow-y-auto">
            {agents
              .filter((agent) => agent.status === "online" || agent.ownerType === "remote")
              .map((agent) => {
                const selected = selectedGroupAgentIds.has(agent.id);
                const isRemote = agent.ownerType === "remote";
                const ownerName = agent.owner?.name ?? agent.ownerId;
                return (
                  <label
                    key={agent.id}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                      agent.stale
                        ? "cursor-not-allowed bg-gray-500/5 opacity-50 grayscale"
                        : "cursor-pointer hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={agent.stale}
                      onChange={() =>
                        setSelectedGroupAgentIds((current) => {
                          const next = new Set(current);
                          if (next.has(agent.id)) next.delete(agent.id);
                          else next.add(agent.id);
                          return next;
                        })
                      }
                      className="h-4 w-4 accent-[var(--accent-color)]"
                    />
                    <AgentAvatar name={agent.name} src={agent.avatar} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{agent.name}</span>
                      {isRemote && (
                        <span className="block truncate text-[11px] text-[var(--text-tertiary)]">
                          {t("chat:owner")}: {ownerName ?? "—"}
                        </span>
                      )}
                    </span>
                    {isRemote && (
                      <span className="shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-300">
                        {t("chat:remoteAgent")}
                      </span>
                    )}
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        agent.stale ? "bg-gray-400" : STATUS_COLORS[agent.status]
                      }`}
                    />
                  </label>
                );
              })}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setIsCreateGroupOpen(false)}
              disabled={isCreatingGroup}
            >
              {t("common:buttons.cancel")}
            </Button>
            <Button
              onClick={() => void handleCreateGroup()}
              disabled={selectedGroupAgentIds.size < 2 || isCreatingGroup}
            >
              {t("common:group.createGroup")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={isAddFriendOpen} onOpenChange={setIsAddFriendOpen}>
        <DialogContent>
          <DialogTitle>{t("sidebar:addFriend")}</DialogTitle>
          <DialogDescription>{t("sidebar:addFriendDesc")}</DialogDescription>
          <div className="mt-4 space-y-3">
            <Input
              placeholder={t("sidebar:hubIdPlaceholder")}
              value={remoteHubId}
              onChange={(e) => setRemoteHubId(e.target.value)}
              disabled={isPairing || !!pairingCode}
            />
            {pairingError && (
              <p className="text-sm text-red-500">{pairingError}</p>
            )}
            {pairingCode && (
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] p-3">
                <p className="text-sm text-[var(--text-secondary)]">{t("sidebar:pairingCodeLabel")}</p>
                <p className="mt-1 text-2xl font-bold tracking-widest text-[var(--accent-color)]">{pairingCode}</p>
                <p className="mt-2 text-xs text-[var(--text-tertiary)]">{t("sidebar:pairingCodeHint")}</p>
              </div>
            )}
            {!pairingCode && (
              <Button
                className="w-full"
                onClick={() => void handlePairFriend()}
                disabled={isPairing || !remoteHubId.trim()}
              >
                {isPairing ? t("sidebar:pairing") : t("sidebar:sendPairRequest")}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <CatalogModal open={isCatalogOpen} onOpenChange={setIsCatalogOpen} />
    </>
  );
}
