import { Globe, Wifi, WifiOff } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useHubStore } from "@/store/hubStore";

const STATUS_POLL_INTERVAL_MS = 30_000;

export function ConnectionStatus() {
  const { t } = useTranslation("common");
  const connectionState = useHubStore((state) => state.hubConnectionState);
  const peers = useHubStore((state) => state.peers);
  const fetchHubStatus = useHubStore((state) => state.fetchHubStatus);
  const connected = connectionState === "connected";
  const p2pPeerCount = peers.filter((peer) => peer.path === "p2p").length;

  useEffect(() => {
    void fetchHubStatus();
    const timer = window.setInterval(() => void fetchHubStatus(), STATUS_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [fetchHubStatus]);

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("hub.connectionStatus")}
            className="mr-2 flex h-11 items-center gap-2 rounded-md px-2 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] md:h-8"
          >
            <span className="relative">
              <Globe aria-hidden="true" className="h-4 w-4" />
              <span
                className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-[var(--bg-base)]"
                style={{
                  backgroundColor: connected ? "var(--status-online)" : "var(--status-offline)",
                }}
              />
            </span>
            {p2pPeerCount > 0 ? (
              <Wifi aria-hidden="true" className="h-4 w-4" />
            ) : (
              <WifiOff aria-hidden="true" className="h-4 w-4" />
            )}
            <span>{p2pPeerCount}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent align="end" className="w-72 p-3">
          <div className="flex items-center justify-between gap-4">
            <span className="font-medium">{t("hub.relay")}</span>
            <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  backgroundColor: connected ? "var(--status-online)" : "var(--status-offline)",
                }}
              />
              {t(`hub.${connectionState}`)}
            </span>
          </div>
          <div className="mt-2 border-t border-[var(--border-color)] pt-2">
            <div className="mb-1.5 font-medium">{t("hub.p2pPeers", { count: p2pPeerCount })}</div>
            {peers.length === 0 ? (
              <p className="text-[var(--text-muted)]">{t("hub.noPeers")}</p>
            ) : (
              <div className="space-y-1.5">
                {peers.map((peer) => (
                  <div
                    key={peer.hubId}
                    className="flex items-center gap-2 text-[var(--text-secondary)]"
                  >
                    <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">
                      {peer.displayName}
                    </span>
                    <span>{t(`hub.path.${peer.path}`)}</span>
                    <span className="w-14 text-right">
                      {peer.latency === null
                        ? t("hub.latencyUnknown")
                        : t("hub.latency", { latency: peer.latency })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
