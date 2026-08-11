import { useEffect } from "react";
import { AlertCircle, Puzzle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { usePluginStore } from "@/store/pluginStore";

export function PluginDiagnostics() {
  const { t } = useTranslation(["common", "settings"]);
  const plugins = usePluginStore((state) => state.plugins);
  const isLoading = usePluginStore((state) => state.isLoading);
  const loadError = usePluginStore((state) => state.loadError);
  const fetchPlugins = usePluginStore((state) => state.fetchPlugins);

  useEffect(() => {
    void fetchPlugins();
  }, [fetchPlugins]);

  return (
    <section
      className="mt-4 rounded-xl border border-[var(--border-color)] bg-[var(--bg-base)] p-4"
      aria-labelledby="loaded-plugins-title"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--accent-hover)]">
          <Puzzle aria-hidden="true" className="h-4 w-4" />
        </span>
        <div>
          <h3 id="loaded-plugins-title" className="text-sm font-medium text-[var(--text-primary)]">
            {t("settings:plugins.loadedTitle")}
          </h3>
          <p className="mt-1 text-xs leading-5 text-[var(--text-tertiary)]">
            {t("settings:plugins.loadedDescription")}
          </p>
        </div>
      </div>

      {loadError && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-3"
        >
          <div className="flex gap-2">
            <AlertCircle
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-error)]"
            />
            <p className="text-xs leading-5 text-[var(--text-secondary)]">
              {t("settings:plugins.loadFailed")}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2 min-h-11 sm:min-h-8"
            onClick={() => void fetchPlugins()}
          >
            <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
            {t("common:buttons.retry")}
          </Button>
        </div>
      )}

      {isLoading && plugins.length === 0 ? (
        <p role="status" className="py-8 text-center text-xs text-[var(--text-muted)]">
          {t("common:loading")}
        </p>
      ) : !loadError && plugins.length === 0 ? (
        <p className="mt-4 rounded-lg bg-[var(--bg-elevated)] p-3 text-xs leading-5 text-[var(--text-tertiary)]">
          {t("settings:plugins.emptyDescription")}
        </p>
      ) : plugins.length > 0 ? (
        <div className="mt-4 space-y-3">
          {plugins.map((plugin) => (
            <article
              key={`${plugin.type}:${plugin.name}`}
              className="rounded-lg border border-[var(--border-color)] p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-medium text-[var(--text-primary)]">{plugin.name}</h4>
                <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-medium uppercase text-[var(--text-tertiary)]">
                  {t(`settings:plugins.types.${plugin.type}`)}
                </span>
                <span className="font-mono text-[10px] text-[var(--text-muted)]">
                  {plugin.version}
                </span>
              </div>
              {plugin.description && (
                <p className="mt-1.5 text-xs leading-5 text-[var(--text-secondary)]">
                  {plugin.description}
                </p>
              )}
              <div className="mt-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                  {t("common:plugins.permissions")}
                </span>
                {plugin.permissions.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {plugin.permissions.map((permission) => (
                      <code
                        key={permission}
                        className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
                      >
                        {permission}
                      </code>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                    {t("settings:plugins.noPermissions")}
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
