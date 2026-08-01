import { useUIStore, type ToastType } from "@/store/uiStore";
import { useTranslation } from "react-i18next";

const TOAST_STYLES: Record<ToastType, string> = {
  error: "border-red-800 bg-red-950/95 text-red-100",
  info: "border-blue-800 bg-[var(--bg-surface)] text-[var(--text-primary)]",
  success: "border-green-800 bg-green-950/95 text-green-100",
};

export function ToastContainer() {
  const { t } = useTranslation("common");
  const toasts = useUIStore((state) => state.toasts);
  const removeToast = useUIStore((state) => state.removeToast);
  const isOffline = useUIStore((state) => state.isOffline);

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 transition-[top] ${
        isOffline ? "top-12" : "top-4"
      }`}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.type === "error" ? "alert" : "status"}
          className={`toast-enter pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-2xl backdrop-blur ${TOAST_STYLES[toast.type]}`}
        >
          <p className="flex-1 text-sm leading-5">{toast.message}</p>
          <button
            type="button"
            onClick={() => removeToast(toast.id)}
            aria-label={t("aria.closeNotification")}
            className="text-lg leading-5 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
