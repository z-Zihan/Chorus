import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  CheckSquare,
  ChevronDown,
  Ellipsis,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { useChatStore, type Conversation } from "@/store/chatStore";
import { useAgentStore } from "@/store/agentStore";
import { useUIStore } from "@/store/uiStore";
import { AgentAvatar } from "@/components/agent/AgentAvatar";
import { AgentSettingsPanel } from "@/components/agent/AgentSettingsPanel";
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
import { STATUS_COLORS } from "@/constants/agent";
import { formatConversationTime } from "@/lib/date";
import { useHotkey } from "@/hooks/useHotkey";
import { useOnboardingStore } from "@/store/onboardingStore";
import { CatalogModal } from "@/components/catalog/CatalogModal";

export function Sidebar() {
  const { t } = useTranslation(["common", "sidebar"]);
  const [conversationToDelete, setConversationToDelete] = useState<Conversation | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [isArchivedOpen, setIsArchivedOpen] = useState(false);
  const [isGroupsOpen, setIsGroupsOpen] = useState(true);
  const [isAgentsOpen, setIsAgentsOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchConfirmation, setShowBatchConfirmation] = useState(false);
  const conversations = useChatStore((s) => s.conversations);
  const groupConversations = useChatStore((s) => s.groupConversations);
  const archivedConversations = useChatStore((s) => s.archivedConversations);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const setCurrentConversation = useChatStore((s) => s.setCurrentConversation);
  const createConversation = useChatStore((s) => s.createConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const togglePin = useChatStore((s) => s.togglePin);
  const toggleArchive = useChatStore((s) => s.toggleArchive);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const deleteConversations = useChatStore((s) => s.deleteConversations);
  const agents = useAgentStore((s) => s.agents);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const conversationAgentFilter = useAgentStore((s) => s.conversationAgentFilter);
  const filterByAgent = useAgentStore((s) => s.filterByAgent);
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
  const closeSidebar = useUIStore((s) => s.closeSidebar);
  const allConversations = [...conversations, ...groupConversations, ...archivedConversations];
  const visibleConversations = conversationAgentFilter
    ? conversations.filter((conversation) => conversation.agentIds.includes(conversationAgentFilter))
    : conversations;
  const visibleGroupConversations = conversationAgentFilter
    ? groupConversations.filter((conversation) => conversation.agentIds.includes(conversationAgentFilter))
    : groupConversations;
  const visibleArchivedConversations = conversationAgentFilter
    ? archivedConversations.filter((conversation) => conversation.agentIds.includes(conversationAgentFilter))
    : archivedConversations;

  const handleSelectConversation = (id: string) => {
    if (isSelectMode) {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    setCurrentConversation(id);
    closeSidebar();
  };

  const handleCreateConversation = async () => {
    await createConversation();
    closeSidebar();
  };

  useHotkey("Ctrl+N", () => void handleCreateConversation(), [createConversation, closeSidebar]);

  const handleConfirmDelete = async () => {
    if (!conversationToDelete) return;
    setIsDeleting(true);
    const deleted = await deleteConversation(conversationToDelete.id);
    setIsDeleting(false);
    if (deleted) setConversationToDelete(null);
  };

  const handleBatchDelete = async () => {
    setIsDeleting(true);
    await deleteConversations([...selectedIds]);
    setIsDeleting(false);
    setShowBatchConfirmation(false);
    setSelectedIds(new Set());
    setIsSelectMode(false);
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

  const toggleSelectMode = () => {
    setIsSelectMode((value) => !value);
    setSelectedIds(new Set());
  };

  const renderConversation = (conv: Conversation) => {
    const conversationAgent = agents.find((agent) => agent.id === conv.agentIds[0]);
    const isAgentOffline = conv.type === "dm" && conversationAgent?.status === "offline";
    const selected = selectedIds.has(conv.id);

    return (
      <div
        key={conv.id}
        onContextMenu={(event) => {
          if (isSelectMode) return;
          event.preventDefault();
          setOpenMenuId(conv.id);
        }}
        className={`group relative flex items-center rounded-lg transition-colors ${
          currentConversationId === conv.id
            ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
        }`}
      >
        {isSelectMode && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => handleSelectConversation(conv.id)}
            aria-label={t("sidebar:selectConversation", { title: conv.title })}
            className="ml-3 h-4 w-4 shrink-0 accent-[var(--accent-color)]"
          />
        )}
        <button
          type="button"
          onClick={() => handleSelectConversation(conv.id)}
          className={`flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left ${isSelectMode ? "pl-2" : ""}`}
        >
          {conv.type === "dm" ? (
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
              {conv.pinned && <Pin aria-label={t("sidebar:pinned")} className="h-3 w-3 shrink-0 text-[var(--accent-hover)]" />}
              <div
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  startRename(conv);
                }}
                className="truncate text-sm font-medium"
              >
                {conv.title || t("sidebar:untitledConversation")}
              </div>
              {isAgentOffline && (
                <span className="shrink-0 rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)] ring-1 ring-[var(--border-color)]">
                  {t("common:status.offline")}
                </span>
              )}
            </div>
            <div className="truncate text-xs text-[var(--text-muted)]">{formatConversationTime(conv.updatedAt)}</div>
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
            className="absolute left-14 right-9 top-2 h-8 bg-[var(--bg-base)]"
          />
        )}

        {!isSelectMode && (
          <DropdownMenu
            open={openMenuId === conv.id}
            onOpenChange={(open) => setOpenMenuId(open ? conv.id : null)}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("sidebar:conversationActions", { title: conv.title })}
                className="mr-2 rounded-md p-1.5 text-[var(--text-tertiary)] opacity-100 outline-none transition hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--accent-color)] md:opacity-0 md:group-hover:opacity-100 md:data-[state=open]:opacity-100"
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
                {conv.pinned ? <PinOff aria-hidden="true" className="h-4 w-4" /> : <Pin aria-hidden="true" className="h-4 w-4" />}
                {t(conv.pinned ? "sidebar:unpin" : "sidebar:pin")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void toggleArchive(conv.id)}>
                {conv.archived ? <ArchiveRestore aria-hidden="true" className="h-4 w-4" /> : <Archive aria-hidden="true" className="h-4 w-4" />}
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
        )}
      </div>
    );
  };

  return (
    <>
      <aside
        className={`absolute inset-y-0 left-0 z-30 flex h-full w-72 max-w-[85vw] shrink-0 flex-col border-r border-[var(--border-color)] bg-[var(--bg-surface)] shadow-2xl transition-transform duration-200 md:static md:max-w-none md:translate-x-0 md:shadow-none ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-[var(--border-color)] px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-color)] text-sm font-bold text-white">AL</div>
          <span className="flex-1 font-semibold text-[var(--text-primary)]">{t("common:appName")}</span>
          <Button variant="ghost" size="icon" onClick={() => void handleCreateConversation()} aria-label={t("sidebar:createConversation")} title={t("sidebar:createConversation")} className="h-8 w-8">
            <Plus aria-hidden="true" className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={closeSidebar} aria-label={t("common:aria.closeSidebar")} className="h-8 w-8 md:hidden">
            <X aria-hidden="true" className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          <div className="mb-4 border-b border-[var(--border-color)] pb-3">
            <button
              type="button"
              onClick={() => setIsAgentsOpen((open) => !open)}
              aria-expanded={isAgentsOpen}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs font-medium uppercase tracking-wider text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
            >
              <span className="flex-1 text-left">{t("sidebar:agents")}</span>
              <span>{agents.length}</span>
              <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${isAgentsOpen ? "rotate-180" : ""}`} />
            </button>
            {isAgentsOpen && (
              <div className="mt-1 space-y-1">
                {agents.length === 0 && (
                  <p className="px-3 py-2 text-sm text-[var(--text-muted)]">{t("sidebar:noAgents")}</p>
                )}
                {agents.map((agent) => {
                  const isActive = conversationAgentFilter === agent.id;
                  return (
                    <button
                      type="button"
                      key={agent.id}
                      onClick={() => filterByAgent(isActive ? null : agent.id)}
                      aria-pressed={isActive}
                      aria-label={t("sidebar:filterByAgent", { name: agent.name })}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                        isActive
                          ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      <span className="relative shrink-0">
                        <AgentAvatar name={agent.name} src={agent.avatar} size="sm" />
                        <span
                          aria-label={t(`common:status.${agent.status}`)}
                          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-surface)] ${STATUS_COLORS[agent.status]}`}
                        />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{agent.name}</span>
                    </button>
                  );
                })}
                {conversationAgentFilter && (
                  <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => filterByAgent(null)}>
                    {t("sidebar:showAllConversations")}
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="mb-2 flex items-center justify-end gap-1 px-2">
            <div className="flex items-center">
              <Button variant="ghost" size="sm" className="h-7 px-2 normal-case" onClick={toggleSelectMode}>
                <CheckSquare aria-hidden="true" className="h-3.5 w-3.5" />
                {t(isSelectMode ? "sidebar:cancelSelect" : "sidebar:select")}
              </Button>
              {!isSelectMode && (
                <Button variant="ghost" size="sm" className="h-7 px-2 normal-case" onClick={() => setIsCatalogOpen(true)}>
                  <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                  {t("common:catalog.addAgent")}
                </Button>
              )}
            </div>
          </div>

          {isSelectMode && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] p-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 flex-1"
                onClick={() => setSelectedIds(new Set(allConversations.map((item) => item.id)))}
              >
                {t("sidebar:selectAll")}
              </Button>
              <Button
                variant="danger"
                size="sm"
                className="h-7 flex-1"
                disabled={selectedIds.size === 0}
                onClick={() => setShowBatchConfirmation(true)}
              >
                {t("sidebar:deleteSelected", { count: selectedIds.size })}
              </Button>
            </div>
          )}

          <div className="mb-4">
            <div className="flex items-center gap-2 px-2 py-2 text-xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
              <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="flex-1">{t("sidebar:dmConversations")}</span>
              <span>{visibleConversations.length}</span>
            </div>
            <div className="mt-1 space-y-1">
              {visibleConversations.length === 0 && (
                <div className="rounded-lg border border-dashed border-[var(--border-color)] px-4 py-6 text-center">
                  <p className="text-sm text-[var(--text-tertiary)]">{t("sidebar:noConversations")}</p>
                  <Button onClick={() => void handleCreateConversation()} size="sm" className="mt-3">
                    <Plus aria-hidden="true" className="h-4 w-4" />
                    {t("sidebar:createConversation")}
                  </Button>
                </div>
              )}
              {visibleConversations.map(renderConversation)}
            </div>
          </div>

          <div className="mb-4 border-t border-[var(--border-color)] pt-2">
            <button
              type="button"
              onClick={() => setIsGroupsOpen((open) => !open)}
              aria-expanded={isGroupsOpen}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs font-medium uppercase tracking-wider text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
            >
              <Users aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="flex-1 text-left">{t("sidebar:groupConversations")}</span>
              <span>{visibleGroupConversations.length}</span>
              <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${isGroupsOpen ? "rotate-180" : ""}`} />
            </button>
            {isGroupsOpen && (
              <div className="mt-1 space-y-1">{visibleGroupConversations.map(renderConversation)}</div>
            )}
          </div>

          {visibleArchivedConversations.length > 0 && (
            <div className="mt-4 border-t border-[var(--border-color)] pt-2">
              <button
                type="button"
                onClick={() => setIsArchivedOpen((open) => !open)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs font-medium uppercase tracking-wider text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
              >
                <Archive aria-hidden="true" className="h-3.5 w-3.5" />
                <span className="flex-1 text-left">{t("sidebar:archived")}</span>
                <span>{visibleArchivedConversations.length}</span>
                <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${isArchivedOpen ? "rotate-180" : ""}`} />
              </button>
              {isArchivedOpen && <div className="mt-1 space-y-1">{visibleArchivedConversations.map(renderConversation)}</div>}
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border-color)] px-2 py-3">
          <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">{t("sidebar:agentStatus")}</div>
          <div className="space-y-1">
            {agents.length === 0 && (
              <div className="px-2 py-2">
                <p className="text-sm text-[var(--text-muted)]">{t("sidebar:noAgents")}</p>
                <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => useOnboardingStore.getState().rescan()}>
                  <Search className="mr-2 h-4 w-4" />{t("common:onboarding.rescan")}
                </Button>
              </div>
            )}
            {agents.map((agent) => (
              <button type="button" key={agent.id} onClick={() => selectAgent(agent.id)} className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-hover)] focus:outline-none">
                <AgentAvatar name={agent.name} src={agent.avatar} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[var(--text-primary)]">{agent.name}</div>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_COLORS[agent.status]}`} />
                    {t(`common:status.${agent.status}`)}
                  </div>
                </div>
                <Settings aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--text-tertiary)] opacity-100 transition group-hover:text-[var(--text-primary)] md:opacity-0 md:group-hover:opacity-100 md:group-focus:opacity-100" />
              </button>
            ))}
          </div>
        </div>
      </aside>

      <ConfirmDialog
        open={Boolean(conversationToDelete)}
        title={t("sidebar:deleteDialogTitle")}
        message={<Trans i18nKey="sidebar:deleteDialogMessage" values={{ title: conversationToDelete?.title || t("sidebar:untitledConversation") }} />}
        confirmLabel={t("common:buttons.delete")}
        isConfirming={isDeleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setConversationToDelete(null)}
      />
      <ConfirmDialog
        open={showBatchConfirmation}
        title={t("sidebar:batchDeleteTitle")}
        message={t("sidebar:batchDeleteMessage", { count: selectedIds.size })}
        confirmLabel={t("common:buttons.delete")}
        isConfirming={isDeleting}
        onConfirm={() => void handleBatchDelete()}
        onCancel={() => setShowBatchConfirmation(false)}
      />
      <AgentSettingsPanel />
      <CatalogModal open={isCatalogOpen} onOpenChange={setIsCatalogOpen} />
    </>
  );
}
