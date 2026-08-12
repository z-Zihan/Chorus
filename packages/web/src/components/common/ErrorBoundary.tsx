import { Component, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logger } from "@/utils/logger";

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
        className="w-full max-w-md rounded-xl border border-[var(--status-error)]/40 bg-[var(--bg-surface)] p-6 text-center shadow-xl"
      >
        <h2 className="text-lg font-semibold">{t("errors:pageError")}</h2>
        <p className="mt-2 break-words text-sm text-[var(--status-error)]">
          {error.message || t("errors:unknown")}
        </p>
        <Button onClick={onRetry} className="mt-5">
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          {t("common:buttons.retry")}
        </Button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error("Render error", { message: error.message, componentStack: info.componentStack });
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return <ErrorFallback error={this.state.error} onRetry={this.retry} />;
  }
}
