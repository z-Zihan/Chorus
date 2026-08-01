import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useTranslation(["common", "errors"]);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--bg-base)] p-6 text-[var(--text-primary)]">
      <div
        role="alert"
        className="w-full max-w-md rounded-xl border border-red-900/60 bg-[var(--bg-surface)] p-6 text-center shadow-xl"
      >
        <h2 className="text-lg font-semibold">{t("errors:pageError")}</h2>
        <p className="mt-2 break-words text-sm text-red-400">
          {error.message || t("errors:unknown")}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-lg bg-[var(--accent-color)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
        >
          {t("common:buttons.retry")}
        </button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Render error:", error, info.componentStack);
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return <ErrorFallback error={this.state.error} onRetry={this.retry} />;
  }
}
