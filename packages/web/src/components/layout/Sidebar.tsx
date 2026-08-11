import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  Bot,
  ArchiveRestore,
  AlertCircle,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  Ellipsis,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { useChatStore, type Conversation } from "@/store/chatStore";
import { api, type PairingSession } from "@/services/api";
import { useAgentStore } from "@/store/agentStore";
import { useHubStore } from "@/store/hubStore";
import { useUIStore } from "@/store/uiStore";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { AgentHealthBadge } from "@/components/agent/AgentHealthBadge";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { STATUS_COLORS } from "@/constants/agent";
import { formatConversationTime } from "@/lib/date";
import { useHotkey } from "@/hooks/useHotkey";
import { useOnboardingStore } from "@/store/onboardingStore";
import { BrandMark } from "@/components/common/BrandMark";
import { RoomInvitations } from "@/components/hub/RoomInvitations";

const CatalogModal = lazy(() =>
  import("@/components/catalog/CatalogModal").then((module) => ({ default: module.CatalogModal })),
);

interface SidebarProps {
  onOpenSettings: () => void;
}

const LAST_GROUP_AGENTS_KEY = "chorus-last-group-agents";
const LABEL_SEPARATOR = ":";
const OPEN_BRACKET = "[";
const CLOSE_BRACKET = "]";

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
  const [isAgentsOpen, setIsAgentsOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAddFriendOpen, setIsAddFriendOpen] = useState(false);
  const [remoteHubId, setRemoteHubId] = useState("");
  const [pairingPackage, setPairingPackage] = useState<string | null>(null);
  const [incomingPairingPackage, setIncomingPairingPackage] = useState("");
  const [pairingSession, setPairingSession] = useState<PairingSession | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);
  const [contacts, setContacts] = useState<
    Array<{ hubId: string; userName?: string; trustLevel: string }>
  >([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [contactsError, setContactsError] = useState(false);
  const hubConnectionState = useHubStore((s) => s.hubConnectionState);
  const fetchHubStatus = useHubStore((s) => s.fetchHubStatus);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [groupCreateError, setGroupCreateError] = useState<string | null>(null);
  const [selectedGroupAgentIds, setSelectedGroupAgentIds] = useState<Set<string>>(new Set());
  const conversations = useChatStore((s) => s.conversations);
  const groupConversations = useChatStore((s) => s.groupConversations);
  const archivedConversations = useChatStore((s) => s.archivedConversations);
  const hasLoadedConversations = useChatStore((s) => s.hasLoadedConversations);
  const conversationsError = useChatStore((s) => s.conversationsError);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const pendingConversationActions = useChatStore((s) => s.pendingConversationActions);
  const setCurrentConversation = useChatStore((s) => s.setCurrentConversation);
  const createConversation = useChatStore((s) => s.createConversation);
  const createGroupConversation = useChatStore((s) => s.createGroupConversation);
  const createRoom = useChatStore((s) => s.createRoom);
  const fetchConversations = useChatStore((s) => s.fetchConversations);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const togglePin = useChatStore((s) => s.togglePin);
  const toggleArchive = useChatStore((s) => s.toggleArchive);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const agents = useAgentStore((s) => s.agents);
  const isLoadingAgents = useAgentStore((s) => s.isLoading);
  const agentLoadError = useAgentStore((s) => s.loadError);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
  const closeSidebar = useUIStore((s) => s.closeSidebar);
  const addToast = useUIStore((s) => s.addToast);
  const initialConversationStarted = useRef(false);
  const allConversations = [...conversations, ...groupConversations, ...archivedConversations];
  const selectedGroupContainsRemote = agents.some(
    (agent) => selectedGroupAgentIds.has(agent.id) && agent.ownerType === "remote",
  );
  const loadContacts = useCallback(async () => {
    setIsLoadingContacts(true);
    setContactsError(false);
    try {
      setContacts(await api.getTrustList(true));
    } catch {
      setContactsError(true);
    } finally {
      setIsLoadingContacts(false);
    }
  }, []);

  useEffect(() => {
    void fetchHubStatus();
    void loadContacts();
  }, [fetchHubStatus, loadContacts]);

  useEffect(() => {
    if (
      !pairingSession ||
      ["trusted", "cancelled", "expired", "failed"].includes(pairingSession.status)
    )
      return;
    const timer = window.setInterval(() => {
      void api
        .getPairingSession(pairingSession.sessionId, true)
        .then((session) => {
          setPairingSession(session);
          if (session.status === "trusted") {
            void loadContacts();
            addToast(t("sidebar:pairingTrusted"), "success");
          }
        })
        .catch((error: unknown) =>
          setPairingError(error instanceof Error ? error.message : String(error)),
        );
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [addToast, loadContacts, pairingSession, t]);

  useEffect(() => {
    if (
      initialConversationStarted.current ||
      !hasLoadedConversations ||
      conversationsError !== null ||
      agents.length === 0 ||
      conversations.length > 0
    )
      return;

    initialConversationStarted.current = true;
    void api
      .createConversation(undefined, agents[0].id, "dm", true)
      .then(async (conversation) => {
        await fetchConversations();
        useChatStore.getState().setCurrentConversation(conversation.id);
        addToast(t("sidebar:firstConversationWelcome"), "success");
      })
      .catch(() => {
        initialConversationStarted.current = false;
        addToast(t("sidebar:firstConversationFailed"), "error");
      });
  }, [
    addToast,
    agents,
    conversations.length,
    conversationsError,
    fetchConversations,
    hasLoadedConversations,
    t,
  ]);

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const matchesSearch = (conversation: Conversation) =>
    !normalizedSearch || conversation.title.toLocaleLowerCase().includes(normalizedSearch);
  const visibleGroupConversations = groupConversations.filter(matchesSearch);
  const visibleConversations = [
    ...conversations.filter(matchesSearch),
    ...visibleGroupConversations,
  ].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
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
    setPairingPackage(null);
    setPairingSession(null);
    setPairingError(null);
    try {
      const result = await api.createPairing(hubId, true);
      setPairingPackage(result.pairingPackage);
      setPairingSession(result.session);
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : "发送配对请求失败");
    } finally {
      setIsPairing(false);
    }
  };

  const handleAcceptPairing = async () => {
    if (!incomingPairingPackage.trim()) return;
    setIsPairing(true);
    setPairingError(null);
    try {
      setPairingSession(await api.acceptPairing(incomingPairingPackage.trim(), true));
      setPairingPackage(null);
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : t("sidebar:pairingFailed"));
    } finally {
      setIsPairing(false);
    }
  };

  const handleCopyPairingPackage = async () => {
    if (!pairingPackage) return;
    try {
      await navigator.clipboard.writeText(pairingPackage);
      addToast(t("sidebar:pairingPackageCopied"), "success");
    } catch {
      addToast(t("common:errors.copyFailed"), "error");
    }
  };

  const handleApprovePairing = async () => {
    if (!pairingSession) return;
    setIsPairing(true);
    try {
      setPairingSession(await api.approvePairing(pairingSession.sessionId, true));
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : t("sidebar:pairingFailed"));
    } finally {
      setIsPairing(false);
    }
  };

  const handleCancelPairing = async () => {
    if (!pairingSession) return;
    try {
      setPairingSession(await api.cancelPairing(pairingSession.sessionId, true));
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : t("sidebar:pairingFailed"));
    }
  };

  const handleCreateConversation = async (agentId?: string) => {
    const conversation = await createConversation(undefined, agentId);
    if (conversation) closeSidebar();
    else addToast(t("sidebar:conversationCreateFailed"), "error");
  };

  const handleCreateGroup = async () => {
    const selectedAgents = agents.filter((agent) => selectedGroupAgentIds.has(agent.id));
    if (selectedAgents.length < 2) return;
    setIsCreatingGroup(true);
    setGroupCreateError(null);
    const conversation = await createGroupConversation(
      selectedAgents
        .map((agent) => agent.name)
        .join(", ")
        .slice(0, 120),
      selectedAgents.map((agent) => agent.id),
    );
    setIsCreatingGroup(false);
    if (!conversation) {
      setGroupCreateError(t("sidebar:groupCreateFailed"));
      return;
    }
    writeLastGroupAgentIds(selectedAgents.map((agent) => agent.id));
    setSelectedGroupAgentIds(new Set());
    setIsCreateGroupOpen(false);
    closeSidebar();
  };

  const handleCreateRoom = async () => {
    setIsCreatingRoom(true);
    const created = await createRoom(t("sidebar:defaultRoomName"));
    setIsCreatingRoom(false);
    if (!created) addToast(t("sidebar:roomCreateFailed"), "error");
  };

  const openCreateGroupDialog = () => {
    const selectableAgentIds = new Set(
      agents
        .filter(
          (agent) => !agent.stale && (agent.status === "online" || agent.ownerType === "remote"),
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
    setDeleteError(null);
    const deleted = await deleteConversation(conversationToDelete.id);
    setIsDeleting(false);
    if (deleted) setConversationToDelete(null);
    else setDeleteError(t("sidebar:deleteFailed"));
  };

  const startRename = (conversation: Conversation) => {
    setEditingId(conversation.id);
    setEditingTitle(conversation.title);
    setRenameError(null);
    setOpenMenuId(null);
  };

  const commitRename = async () => {
    if (!editingId) return;
    if (pendingConversationActions[editingId] === "rename") return;
    const conversation = allConversations.find((item) => item.id === editingId);
    const title = editingTitle.trim();
    if (!title) {
      setRenameError(t("sidebar:titleRequired"));
      return;
    }
    if (title === conversation?.title) {
      setEditingId(null);
      setRenameError(null);
      return;
    }
    const renamed = await renameConversation(editingId, title);
    if (renamed) {
      setEditingId(null);
      setRenameError(null);
    } else {
      setRenameError(t("sidebar:renameFailed"));
    }
  };

  const handleTogglePin = async (conversation: Conversation) => {
    if (!(await togglePin(conversation.id))) addToast(t("sidebar:pinFailed"), "error");
  };

  const handleToggleArchive = async (conversation: Conversation) => {
    if (!(await toggleArchive(conversation.id))) addToast(t("sidebar:archiveFailed"), "error");
  };

  const renderConversation = (conv: Conversation, nested = false) => {
    const conversationAgent = agents.find((agent) => agent.id === conv.agentIds[0]);
    const isAgentOffline = conv.type === "dm" && conversationAgent?.status === "offline";
    const pendingAction = pendingConversationActions[conv.id];

    return (
      <div
        key={conv.id}
        onContextMenu={(event) => {
          event.preventDefault();
          setOpenMenuId(conv.id);
        }}
        className={`group relative flex flex-wrap items-center transition-colors ${nested ? "ml-5 border-l border-[var(--border-color)] pl-1" : "rounded-lg"} ${
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
                <span className="shrink-0 rounded bg-[var(--info-subtle)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--status-info)]">
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
              if (event.key === "Escape") {
                setEditingId(null);
                setRenameError(null);
              }
            }}
            onClick={(event) => event.stopPropagation()}
            aria-label={t("sidebar:renameConversation")}
            aria-invalid={Boolean(renameError)}
            className={`absolute ${nested ? "left-8 top-1" : "left-14 top-1.5"} right-12 h-11 max-w-[calc(100%-4rem)] truncate bg-[var(--bg-base)] md:right-9 md:h-8 md:max-w-[calc(100%-3.5rem)] ${renameError ? "border-[var(--status-error)]" : ""}`}
          />
        )}

        {editingId === conv.id && renameError && (
          <p role="alert" className="basis-full px-3 pb-2 text-xs text-[var(--status-error)]">
            {renameError}
          </p>
        )}

        <DropdownMenu
          open={openMenuId === conv.id}
          onOpenChange={(open) => setOpenMenuId(open ? conv.id : null)}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={Boolean(pendingAction)}
              aria-busy={Boolean(pendingAction)}
              aria-label={t("sidebar:conversationActions", { title: conv.title })}
              className={`${nested ? "mr-1" : "mr-2"} flex h-11 w-11 items-center justify-center rounded-md text-[var(--text-tertiary)] opacity-100 outline-none transition hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--accent-color)] md:h-auto md:w-auto md:p-1.5 md:opacity-0 md:group-hover:opacity-100 md:data-[state=open]:opacity-100`}
            >
              {pendingAction ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : (
                <Ellipsis aria-hidden="true" className="h-4 w-4" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={Boolean(pendingAction)} onSelect={() => startRename(conv)}>
              <Pencil aria-hidden="true" className="h-4 w-4" />
              {t("sidebar:rename")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={Boolean(pendingAction)}
              onSelect={() => void handleTogglePin(conv)}
            >
              {conv.pinned ? (
                <PinOff aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Pin aria-hidden="true" className="h-4 w-4" />
              )}
              {t(conv.pinned ? "sidebar:unpin" : "sidebar:pin")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={Boolean(pendingAction)}
              onSelect={() => void handleToggleArchive(conv)}
            >
              {conv.archived ? (
                <ArchiveRestore aria-hidden="true" className="h-4 w-4" />
              ) : (
                <Archive aria-hidden="true" className="h-4 w-4" />
              )}
              {t(conv.archived ? "sidebar:unarchive" : "sidebar:archive")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                setDeleteError(null);
                setConversationToDelete(conv);
              }}
              disabled={Boolean(pendingAction)}
              className="text-[var(--status-error)] data-[highlighted]:text-[var(--status-error)]"
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
          className="hidden h-14 w-10 shrink-0 items-center justify-center border-r border-[var(--border-color)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] md:flex"
        >
          <PanelLeftOpen aria-hidden="true" className="h-5 w-5" />
        </button>
      )}
      <aside
        className={`absolute inset-y-0 left-0 z-30 flex h-full w-80 max-w-[85vw] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-surface)] shadow-2xl transition-all duration-300 ease-out md:static md:w-72 md:max-w-none md:translate-x-0 md:shadow-none ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"} ${isSidebarCollapsed ? "md:-ml-72 md:overflow-hidden md:border-r-0 md:opacity-0" : "md:ml-0 md:opacity-100"}`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-[var(--border-color)] px-4">
          <BrandMark className="h-8 w-8 text-[var(--accent-color)]" />
          <span className="flex-1 font-semibold text-[var(--text-primary)]">
            {t("common:appName")}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void handleCreateConversation()}
            aria-label={t("sidebar:createConversation")}
            title={t("sidebar:createConversation")}
            className="h-11 w-11 md:h-8 md:w-8"
          >
            <Plus aria-hidden="true" className="h-5 w-5" />
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
            className="h-11 w-11 md:hidden"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </Button>
        </div>

        <div className="space-y-2 border-b border-[var(--border-color)] px-3 py-3">
          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-2 focus-within:border-[var(--focus-ring)] focus-within:ring-2 focus-within:ring-[var(--focus-ring)]/35">
            <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t("sidebar:searchConversations")}
              aria-label={t("sidebar:searchConversations")}
              className="min-h-6 min-w-0 flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
            />
          </label>
          <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-1.5">
            <Button
              size="sm"
              className="min-h-11 gap-1 whitespace-nowrap px-1.5 text-xs md:min-h-8"
              onClick={() => void handleCreateConversation()}
            >
              <Plus aria-hidden="true" className="hidden h-3.5 w-3.5 sm:block" />
              {t("sidebar:newChat")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="min-h-11 gap-1 whitespace-nowrap px-1.5 text-xs md:min-h-8"
              onClick={openCreateGroupDialog}
              aria-label={t("common:group.createGroup")}
            >
              <Users aria-hidden="true" className="hidden h-3.5 w-3.5 sm:block" />
              {t("sidebar:newGroup")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="min-h-11 gap-1 whitespace-nowrap px-1.5 text-xs md:min-h-8"
              onClick={() => setIsAddFriendOpen(true)}
            >
              <UserPlus aria-hidden="true" className="hidden h-3.5 w-3.5 sm:block" />
              {t("sidebar:addFriendShort")}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          {hubConnectionState === "connected" && <RoomInvitations />}

          <section aria-labelledby="conversation-list-title">
            <div className="flex items-center gap-2 px-2 pb-2">
              <h2
                id="conversation-list-title"
                className="flex-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]"
              >
                {t("sidebar:conversations")}
              </h2>
              <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
                {visibleConversations.length}
              </span>
            </div>
            <div className="space-y-1">
              {visibleConversations.map((conversation) => renderConversation(conversation))}
              {!hasLoadedConversations && (
                <div
                  className="flex items-center justify-center gap-2 rounded-lg px-4 py-6 text-sm text-[var(--text-muted)]"
                  role="status"
                >
                  <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin" />
                  {t("sidebar:loadingConversations")}
                </div>
              )}
              {conversationsError && (
                <div
                  role="alert"
                  className="rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 px-3 py-3"
                >
                  <div className="flex items-start gap-2">
                    <AlertCircle
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-error)]"
                    />
                    <p className="min-w-0 flex-1 text-xs leading-5 text-[var(--text-secondary)]">
                      {t("sidebar:conversationLoadFailed")}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2 w-full"
                    onClick={() => void fetchConversations()}
                  >
                    <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                    {t("common:buttons.retry")}
                  </Button>
                </div>
              )}
              {hasLoadedConversations &&
                !conversationsError &&
                visibleConversations.length === 0 && (
                  <div className="rounded-lg border border-dashed border-[var(--border-color)] px-4 py-6 text-center">
                    <p className="text-sm font-medium text-[var(--text-secondary)]">
                      {normalizedSearch
                        ? t("sidebar:noSearchResults")
                        : t("sidebar:noConversations")}
                    </p>
                    {!normalizedSearch && agents.length > 0 && (
                      <Button
                        size="sm"
                        className="mt-3"
                        onClick={() => void handleCreateConversation()}
                      >
                        <Plus aria-hidden="true" className="h-4 w-4" />
                        {t("sidebar:newChat")}
                      </Button>
                    )}
                  </div>
                )}
            </div>
          </section>

          {isLoadingAgents && agents.length === 0 && (
            <div
              className="mt-4 flex items-center justify-center gap-2 rounded-lg px-4 py-5 text-sm text-[var(--text-muted)]"
              role="status"
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin" />
              {t("sidebar:loadingAgents")}
            </div>
          )}

          {agentLoadError && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 px-3 py-3"
            >
              <div className="flex items-start gap-2">
                <AlertCircle
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-error)]"
                />
                <p className="min-w-0 flex-1 text-xs leading-5 text-[var(--text-secondary)]">
                  {t("sidebar:agentLoadFailed")}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2 w-full"
                onClick={() => void fetchAgents()}
              >
                <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                {t("common:buttons.retry")}
              </Button>
            </div>
          )}

          {!isLoadingAgents && !agentLoadError && agents.length === 0 && (
            <div className="mt-4 rounded-lg border border-dashed border-[var(--border-color)] px-4 py-5 text-center">
              <p className="text-sm font-medium text-[var(--text-secondary)]">
                {t("sidebar:noAgents")}
              </p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {t("sidebar:noAgentsDescription")}
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="min-h-11 md:min-h-8"
                  onClick={() => useOnboardingStore.getState().rescan()}
                >
                  <Search aria-hidden="true" className="h-4 w-4" />
                  {t("common:onboarding.rescan")}
                </Button>
                <Button
                  size="sm"
                  className="min-h-11 md:min-h-8"
                  onClick={() => setIsCatalogOpen(true)}
                >
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  {t("common:catalog.addAgent")}
                </Button>
              </div>
            </div>
          )}

          {hubConnectionState === "connected" &&
            (() => {
              if (isLoadingContacts) {
                return (
                  <div
                    className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-3"
                    role="status"
                  >
                    <p className="text-xs text-[var(--text-muted)]">
                      {t("sidebar:loadingContacts")}
                    </p>
                  </div>
                );
              }
              if (contactsError) {
                return (
                  <div
                    role="alert"
                    className="mt-4 rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 px-3 py-3"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-error)]"
                      />
                      <p className="min-w-0 flex-1 text-xs leading-5 text-[var(--text-secondary)]">
                        {t("sidebar:contactsLoadFailed")}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2 min-h-11 w-full md:min-h-8"
                      onClick={() => void loadContacts()}
                    >
                      <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
                      {t("common:buttons.retry")}
                    </Button>
                  </div>
                );
              }
              const hasContacts = contacts.length > 0;
              const hasRooms = groupConversations.some(
                (conversation) => conversation.type === "cross_hub",
              );
              if (hasContacts && hasRooms) return null;
              return (
                <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-3">
                  <p className="text-xs font-semibold text-[var(--text-secondary)]">
                    {t("sidebar:collabGuide")}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                    {hasContacts ? t("sidebar:collabReadyForRoom") : t("sidebar:collabNeedsFriend")}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2 min-h-11 md:min-h-8"
                    disabled={hasContacts ? isCreatingRoom : false}
                    onClick={() =>
                      hasContacts ? void handleCreateRoom() : setIsAddFriendOpen(true)
                    }
                  >
                    {hasContacts
                      ? isCreatingRoom
                        ? t("sidebar:creatingRoom")
                        : t("sidebar:createNow")
                      : t("sidebar:addFriend")}
                  </Button>
                </div>
              );
            })()}

          {agents.length > 0 && (
            <section className="mt-4 border-t border-[var(--border-color)] pt-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setIsAgentsOpen((open) => !open)}
                  aria-expanded={isAgentsOpen}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] md:min-h-0"
                >
                  <Bot aria-hidden="true" className="h-3.5 w-3.5" />
                  <span className="flex-1 text-left">{t("sidebar:agents")}</span>
                  <span>{agents.length}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 transition-transform ${isAgentsOpen ? "rotate-180" : ""}`}
                  />
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0 md:h-7 md:w-7"
                  onClick={() => setIsCatalogOpen(true)}
                  aria-label={t("common:catalog.addAgent")}
                  title={t("common:catalog.addAgent")}
                >
                  <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                </Button>
              </div>
              {isAgentsOpen && (
                <div className="mt-1 space-y-0.5">
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => void handleCreateConversation(agent.id)}
                      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-[var(--bg-hover)] md:min-h-0"
                    >
                      <span className="relative shrink-0">
                        <AgentAvatar name={agent.name} src={agent.avatar} size="xs" />
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-surface)] ${agent.stale ? "bg-[var(--status-offline)]" : STATUS_COLORS[agent.status]}`}
                        />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">
                        {agent.name}
                      </span>
                      <AgentHealthBadge agentId={agent.id} />
                      <Plus
                        aria-hidden="true"
                        className="h-3.5 w-3.5 text-[var(--text-tertiary)]"
                      />
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {visibleArchivedConversations.length > 0 && (
            <div className="mt-4 border-t border-[var(--border-color)] pt-2">
              <button
                type="button"
                onClick={() => setIsArchivedOpen((open) => !open)}
                aria-expanded={isArchivedOpen}
                className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] md:min-h-0"
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
          <Button
            variant="ghost"
            className="min-h-11 w-full justify-start md:min-h-10"
            onClick={onOpenSettings}
          >
            <Settings aria-hidden="true" className="h-4 w-4" />
            {t("common:settings.title")}
          </Button>
        </div>
      </aside>

      <ConfirmDialog
        open={Boolean(conversationToDelete)}
        title={t("sidebar:deleteDialogTitle")}
        message={
          <div>
            <Trans
              i18nKey="sidebar:deleteDialogMessage"
              values={{ title: conversationToDelete?.title || t("sidebar:untitledConversation") }}
            />
            {deleteError && (
              <p role="alert" className="mt-3 text-sm text-[var(--status-error)]">
                {deleteError}
              </p>
            )}
          </div>
        }
        confirmLabel={t("common:buttons.delete")}
        isConfirming={isDeleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => {
          setConversationToDelete(null);
          setDeleteError(null);
        }}
      />

      <Dialog
        open={isCreateGroupOpen}
        onOpenChange={(open) => {
          if (open) {
            setGroupCreateError(null);
            openCreateGroupDialog();
          } else {
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
                className="rounded bg-[var(--info-subtle)] px-1.5 py-0.5 text-xs font-medium text-[var(--status-info)]"
              >
                {OPEN_BRACKET}
                {t("chat:crossHub")}
                {CLOSE_BRACKET}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="mt-1">{t("common:group.selectAgents")}</DialogDescription>
          {groupCreateError && (
            <p
              role="alert"
              className="mt-3 rounded-lg bg-[var(--danger-subtle)] px-3 py-2 text-sm text-[var(--status-error)]"
            >
              {groupCreateError}
            </p>
          )}
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
                        ? "cursor-not-allowed bg-[var(--bg-elevated)] opacity-50 grayscale"
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
                          {t("chat:owner")}
                          {LABEL_SEPARATOR} {ownerName ?? "—"}
                        </span>
                      )}
                    </span>
                    {isRemote && (
                      <span className="shrink-0 rounded bg-[var(--info-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--status-info)]">
                        {t("chat:remoteAgent")}
                      </span>
                    )}
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        agent.stale ? "bg-[var(--status-offline)]" : STATUS_COLORS[agent.status]
                      }`}
                    />
                  </label>
                );
              })}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              variant="ghost"
              className="min-h-11 sm:min-h-10"
              onClick={() => setIsCreateGroupOpen(false)}
              disabled={isCreatingGroup}
            >
              {t("common:buttons.cancel")}
            </Button>
            <Button
              className="min-h-11 sm:min-h-10"
              onClick={() => void handleCreateGroup()}
              disabled={selectedGroupAgentIds.size < 2 || isCreatingGroup}
            >
              {isCreatingGroup ? t("sidebar:creatingGroup") : t("common:group.createGroup")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={isAddFriendOpen} onOpenChange={setIsAddFriendOpen}>
        <DialogContent>
          <DialogTitle className="flex items-center gap-2">{t("sidebar:addFriend")}</DialogTitle>
          <DialogDescription>{t("sidebar:addFriendDesc")}</DialogDescription>
          <div className="mt-4 space-y-3">
            {!pairingSession && (
              <>
                <Input
                  placeholder={t("sidebar:hubIdPlaceholder")}
                  aria-label={t("common:hub.hubId")}
                  className="min-h-11"
                  value={remoteHubId}
                  onChange={(e) => setRemoteHubId(e.target.value)}
                  disabled={isPairing}
                />
                <Button
                  className="min-h-11 w-full"
                  onClick={() => void handlePairFriend()}
                  disabled={isPairing || !remoteHubId.trim()}
                >
                  {isPairing ? t("sidebar:pairing") : t("sidebar:createPairingPackage")}
                </Button>
                <div className="flex items-center gap-3 text-xs text-[var(--text-tertiary)]">
                  <span className="h-px flex-1 bg-[var(--border-color)]" />
                  {t("sidebar:orAcceptPackage")}
                  <span className="h-px flex-1 bg-[var(--border-color)]" />
                </div>
                <textarea
                  aria-label={t("sidebar:incomingPairingPackage")}
                  placeholder={t("sidebar:incomingPairingPackage")}
                  value={incomingPairingPackage}
                  onChange={(event) => setIncomingPairingPackage(event.target.value)}
                  className="min-h-24 w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] p-3 text-xs text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent-color)]"
                />
                <Button
                  variant="secondary"
                  className="min-h-11 w-full"
                  onClick={() => void handleAcceptPairing()}
                  disabled={isPairing || !incomingPairingPackage.trim()}
                >
                  {t("sidebar:acceptPairingPackage")}
                </Button>
              </>
            )}
            {pairingError && (
              <p role="alert" className="text-sm text-[var(--status-error)]">
                {pairingError}
              </p>
            )}
            {pairingPackage && pairingSession?.status === "waiting_peer" && (
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] p-3">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {t("sidebar:pairingPackageLabel")}
                </p>
                <p className="mt-2 break-all rounded bg-[var(--bg-elevated)] p-2 font-mono text-[10px] text-[var(--text-secondary)]">
                  {pairingPackage}
                </p>
                <Button
                  className="mt-3 min-h-11 w-full"
                  variant="secondary"
                  onClick={() => void handleCopyPairingPackage()}
                >
                  {t("sidebar:copyPairingPackage")}
                </Button>
                <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                  {t("sidebar:pairingPackageHint")}
                </p>
              </div>
            )}
            {pairingSession && pairingSession.status !== "waiting_peer" && (
              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] p-3">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {pairingSession.remoteUserName ?? pairingSession.remoteHubId.slice(0, 12)}
                </p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  {t(`sidebar:pairingStatus.${pairingSession.status}`)}
                </p>
                {pairingSession.sas && (
                  <div className="mt-3 rounded-lg bg-[var(--accent-subtle)] p-3 text-center">
                    <p className="text-xs text-[var(--text-secondary)]">
                      {t("sidebar:pairingSasLabel")}
                    </p>
                    <p className="mt-1 text-3xl font-bold tracking-[0.25em] text-[var(--accent-color)]">
                      {pairingSession.sas}
                    </p>
                    <p className="mt-2 text-xs text-[var(--text-tertiary)]">
                      {t("sidebar:compareSasHint")}
                    </p>
                  </div>
                )}
                {pairingSession.status === "awaiting_approval" && (
                  <Button
                    className="mt-3 min-h-11 w-full"
                    onClick={() => void handleApprovePairing()}
                    disabled={isPairing || pairingSession.localApproved}
                  >
                    {pairingSession.localApproved
                      ? t("sidebar:waitingPeerApproval")
                      : t("sidebar:approvePairing")}
                  </Button>
                )}
              </div>
            )}
            {pairingSession &&
              !["trusted", "cancelled", "expired", "failed"].includes(pairingSession.status) && (
                <Button
                  variant="ghost"
                  className="min-h-11 w-full"
                  onClick={() => void handleCancelPairing()}
                >
                  {t("common:buttons.cancel")}
                </Button>
              )}
          </div>
        </DialogContent>
      </Dialog>
      {isCatalogOpen && (
        <Suspense fallback={null}>
          <CatalogModal open onOpenChange={setIsCatalogOpen} />
        </Suspense>
      )}
    </>
  );
}
