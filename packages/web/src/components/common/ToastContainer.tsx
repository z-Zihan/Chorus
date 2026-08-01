import {
  Close as ToastClose,
  Description as ToastDescription,
  Provider as ToastProvider,
  Root as ToastRoot,
  Viewport as ToastViewport,
} from "@radix-ui/react-toast";
import { AlertCircle, CheckCircle, Info, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { useUIStore, type ToastType } from "@/store/uiStore";

const TOAST_STYLES: Record<ToastType, string> = {
  error: "border-red-700 bg-red-950 text-red-100",
  info: "border-blue-700 bg-[var(--bg-surface)] text-[var(--text-primary)]",
  success: "border-green-700 bg-green-950 text-green-100",
};

const TOAST_ICONS = {
  error: AlertCircle,
  info: Info,
  success: CheckCircle,
} satisfies Record<ToastType, typeof Info>;

export function ToastContainer() {
  const { t } = useTranslation("common");
  const toasts = useUIStore((state) => state.toasts);
  const removeToast = useUIStore((state) => state.removeToast);
  const isOffline = useUIStore((state) => state.isOffline);

  return (
    <ToastProvider duration={5_000} swipeDirection="right">
      {toasts.map((toast) => {
        const Icon = TOAST_ICONS[toast.type];

        return (
          <ToastRoot
            key={toast.id}
            open
            type={toast.type === "error" ? "foreground" : "background"}
            onOpenChange={(open) => {
              if (!open) removeToast(toast.id);
            }}
            className={cn(
              "grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-lg border px-4 py-3 shadow-2xl backdrop-blur data-[state=closed]:animate-[toast-out_150ms_ease-in] data-[state=open]:animate-[toast-in_200ms_ease-out] data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=move]:transition-none",
              TOAST_STYLES[toast.type],
            )}
          >
            <Icon aria-hidden="true" className="mt-0.5 h-5 w-5" />
            <ToastDescription className="text-sm leading-5">{toast.message}</ToastDescription>
            <ToastClose
              aria-label={t("aria.closeNotification")}
              className="rounded p-0.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </ToastClose>
          </ToastRoot>
        );
      })}
      <ToastViewport
        className={cn(
          "pointer-events-none fixed right-4 z-[80] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none transition-[top]",
          isOffline ? "top-12" : "top-4",
        )}
      />
    </ToastProvider>
  );
}
