import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep console for diagnostics; UI shows friendly fallback
    console.error('UI error boundary caught', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6 text-center" role="alert">
          <p className="text-sm font-black text-content">Something went wrong in {this.props.fallbackLabel || 'this view'}.</p>
          <p className="mt-1 text-xs text-content-faint">Your data is safe. Try reloading the view.</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
