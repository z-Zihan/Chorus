import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ExternalLink, Package, Plus, Terminal, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AgentManager } from "@/components/catalog/AgentManager";
import { PasswordInput } from "@/components/common/PasswordInput";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import {
  useCatalogStore,
  type CatalogEntry,
  type InstallMethod,
  type InstallRecipe,
} from "@/store/catalogStore";

type Filter = "all" | "cli" | "api" | "installed";

interface CatalogModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CatalogModal({ open, onOpenChange }: CatalogModalProps) {
  const { t } = useTranslation("common");
  const entries = useCatalogStore((state) => state.entries);
  const selectedEntry = useCatalogStore((state) => state.selectedEntry);
  const installation = useCatalogStore((state) => state.installation);
  const isLoading = useCatalogStore((state) => state.isLoading);
  const fetchCatalog = useCatalogStore((state) => state.fetchCatalog);
  const selectEntry = useCatalogStore((state) => state.selectEntry);
  const installAgent = useCatalogStore((state) => state.installAgent);
  const cancelInstall = useCatalogStore((state) => state.cancelInstall);
  const [filter, setFilter] = useState<Filter>("all");
  const [confirming, setConfirming] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [recipeMethod, setRecipeMethod] = useState<InstallMethod | undefined>();

  useEffect(() => {
    if (open) void fetchCatalog();
  }, [open, fetchCatalog]);

  const filteredEntries = useMemo(() => entries.filter((entry) => {
    if (filter === "cli") return entry.kind !== "api-connector";
    if (filter === "api") return entry.kind === "api-connector";
    if (filter === "installed") return entry.installed;
    return true;
  }), [entries, filter]);

  const selectedRecipe = selectedEntry?.installRecipes.find((recipe) => recipe.method === recipeMethod)
    ?? preferredRecipe(selectedEntry);
  const isRunning = installation && !["done", "error"].includes(installation.stage);
  const handleSelectEntry = (entry: CatalogEntry | null) => {
    setConfirming(false);
    setApiKey("");
    setRecipeMethod(preferredRecipe(entry)?.method);
    selectEntry(entry);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="catalog-description"
        className="inset-0 flex h-screen w-screen max-w-none translate-x-0 translate-y-0 flex-col rounded-none p-0"
        onEscapeKeyDown={(event) => { if (isRunning) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (isRunning) event.preventDefault(); }}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-[var(--border-color)] px-5 md:px-8">
          {selectedEntry && (
            <Button variant="ghost" size="icon" disabled={Boolean(isRunning)} onClick={() => handleSelectEntry(null)} aria-label={t("catalog.back")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg">{selectedEntry?.name ?? t("catalog.title")}</DialogTitle>
            <DialogDescription id="catalog-description" className="truncate text-xs">
              {selectedEntry?.summary ?? t("catalog.subtitle")}
            </DialogDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} disabled={Boolean(isRunning)} aria-label={t("buttons.close")}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {selectedEntry ? (
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto grid w-full max-w-5xl gap-8 px-5 py-8 md:grid-cols-[1fr_320px] md:px-8">
              <div>
                <div className="mb-6 flex items-start gap-4">
                  <EntryIcon entry={selectedEntry} large />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold">{selectedEntry.name}</h2>
                      <KindBadge entry={selectedEntry} />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{selectedEntry.summary}</p>
                    <p className="mt-1 text-xs text-[var(--text-tertiary)]">{selectedEntry.publisher.name} · {selectedEntry.license}</p>
                  </div>
                </div>

                <section className="mb-6">
                  <h3 className="mb-2 text-sm font-medium">{t("catalog.permissions")}</h3>
                  <ul className="space-y-2">
                    {selectedEntry.permissions.map((permission) => (
                      <li key={permission} className="flex gap-2 text-sm text-[var(--text-secondary)]">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-hover)]" />{permission}
                      </li>
                    ))}
                  </ul>
                </section>

                <a className="inline-flex items-center gap-1.5 text-sm text-[var(--accent-hover)] hover:underline" href={selectedEntry.homepage} target="_blank" rel="noreferrer">
                  {t("catalog.homepage")}<ExternalLink className="h-4 w-4" />
                </a>
              </div>

              <aside className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-5">
                {selectedEntry.installed && !installation ? (
                  <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><Check className="h-5 w-5 text-green-500" />{t("catalog.installed")}</div>
                ) : installation ? (
                  <InstallationProgress onCancel={() => void cancelInstall()} />
                ) : confirming ? (
                  <div>
                    <h3 className="text-sm font-medium">{t("catalog.confirmTitle")}</h3>
                    <p className="mt-2 text-xs leading-5 text-[var(--text-tertiary)]">{t("catalog.confirmDescription")}</p>
                    {selectedEntry.kind === "api-connector" ? (
                      <p className="mt-4 rounded-lg bg-[var(--bg-elevated)] p-3 font-mono text-xs">{t("catalog.noCommand")}</p>
                    ) : (
                      <code className="mt-4 block overflow-x-auto rounded-lg bg-[var(--bg-elevated)] p-3 text-xs text-[var(--text-primary)]">{formatCommand(selectedRecipe)}</code>
                    )}
                    <div className="mt-5 flex gap-2">
                      <Button variant="secondary" className="flex-1" onClick={() => setConfirming(false)}>{t("buttons.cancel")}</Button>
                      <Button className="flex-1" disabled={selectedEntry.kind === "api-connector" && !apiKey.trim()} onClick={() => void installAgent(selectedEntry.id, { recipeMethod: selectedRecipe?.method, apiKey, acceptPermissions: true })}>{t("buttons.confirm")}</Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {selectedEntry.kind === "api-connector" && (
                      <PasswordInput label={t("catalog.apiKey")} value={apiKey} onChange={setApiKey} placeholder={t("catalog.apiKeyPlaceholder")} />
                    )}
                    {selectedEntry.installRecipes.length > 1 && (
                      <label className="block text-sm">
                        <span className="mb-2 block text-[var(--text-secondary)]">{t("catalog.installMethod")}</span>
                        <select value={recipeMethod} onChange={(event) => setRecipeMethod(event.target.value as InstallMethod)} className="h-10 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] px-3 text-sm">
                          {selectedEntry.installRecipes.map((recipe) => <option key={recipe.method} value={recipe.method}>{recipe.method}</option>)}
                        </select>
                      </label>
                    )}
                    <Button className="w-full" disabled={selectedEntry.kind === "api-connector" && !apiKey.trim()} onClick={() => setConfirming(true)}>
                      <Plus className="h-4 w-4" />{t("catalog.install")}
                    </Button>
                  </div>
                )}
              </aside>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-6xl px-5 py-6 md:px-8">
              <div className="mb-6 flex flex-wrap gap-2">
                {(["all", "cli", "api", "installed"] as Filter[]).map((item) => (
                  <Button key={item} size="sm" variant={filter === item ? "primary" : "secondary"} onClick={() => setFilter(item)}>{t(`catalog.filters.${item}`)}</Button>
                ))}
              </div>
              {filter === "installed" ? <AgentManager /> : isLoading ? (
                <p className="py-16 text-center text-sm text-[var(--text-muted)]">{t("loading")}</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredEntries.map((entry) => (
                    <button key={entry.id} type="button" onClick={() => handleSelectEntry(entry)} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-surface)] p-4 text-left transition hover:border-[var(--accent-color)] hover:bg-[var(--bg-hover)]">
                      <div className="flex items-start gap-3"><EntryIcon entry={entry} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><h3 className="truncate font-medium">{entry.name}</h3>{entry.installed && <Check className="h-4 w-4 shrink-0 text-green-500" />}</div><KindBadge entry={entry} /></div></div>
                      <p className="mt-3 line-clamp-2 text-sm leading-5 text-[var(--text-secondary)]">{entry.summary}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EntryIcon({ entry, large = false }: { entry: CatalogEntry; large?: boolean }) {
  const Icon = entry.kind === "api-connector" ? Package : Terminal;
  return <div className={cn("flex shrink-0 items-center justify-center rounded-xl bg-[var(--bg-elevated)] text-[var(--accent-hover)]", large ? "h-14 w-14" : "h-11 w-11")}><Icon className={large ? "h-7 w-7" : "h-5 w-5"} /></div>;
}

function KindBadge({ entry }: { entry: CatalogEntry }) {
  const { t } = useTranslation("common");
  return <span className="mt-1 inline-block rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-medium uppercase text-[var(--text-tertiary)]">{t(`catalog.kinds.${entry.kind}`)}</span>;
}

function InstallationProgress({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation("common");
  const installation = useCatalogStore((state) => state.installation);
  if (!installation) return null;
  return <div><div className="flex items-center justify-between text-sm"><span>{installation.stage === "error" ? t("catalog.failed") : installation.stage === "done" ? t("catalog.installed") : t("catalog.installing")}</span><span>{t("catalog.progress", { progress: installation.progress })}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]"><div className={cn("h-full transition-all", installation.stage === "error" ? "bg-red-500" : "bg-[var(--accent-color)]")} style={{ width: `${installation.progress}%` }} /></div><p className="mt-3 text-xs text-[var(--text-tertiary)]">{t(`catalog.stages.${installation.stage}`)}</p>{installation.error && <p className="mt-2 break-words text-xs text-red-400">{installation.error}</p>}{!["done", "error"].includes(installation.stage) && <Button variant="secondary" className="mt-5 w-full" onClick={onCancel}>{t("catalog.cancelInstall")}</Button>}</div>;
}

function preferredRecipe(entry: CatalogEntry | null): InstallRecipe | undefined {
  if (!entry) return undefined;
  const platform = navigator.platform.toLowerCase();
  const method: InstallMethod = platform.includes("mac") ? "brew" : platform.includes("win") ? "winget" : "npm";
  return entry.installRecipes.find((recipe) => recipe.method === method) ?? entry.installRecipes[0];
}

function formatCommand(recipe?: InstallRecipe): string {
  if (!recipe) return "";
  return [recipe.executable, ...recipe.args].map((part) => /^[\w@%+=:,./-]+$/u.test(part) ? part : JSON.stringify(part)).join(" ");
}
