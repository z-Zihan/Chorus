import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
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

    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-gray-950 p-6 text-gray-100">
        <div
          role="alert"
          className="w-full max-w-md rounded-xl border border-red-900/60 bg-gray-900 p-6 text-center shadow-xl"
        >
          <h2 className="text-lg font-semibold">页面出现错误</h2>
          <p className="mt-2 break-words text-sm text-red-300">
            {this.state.error.message || "发生了未知错误"}
          </p>
          <button
            type="button"
            onClick={this.retry}
            className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
          >
            重试
          </button>
        </div>
      </div>
    );
  }
}
