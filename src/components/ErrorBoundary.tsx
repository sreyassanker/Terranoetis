import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  label?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ''}]`, error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', textAlign: 'center', gap: 12, height: '100%',
        }}>
          <AlertCircle size={28} color="#ef4444" style={{ opacity: 0.6 }} />
          <div style={{ fontSize: 13, color: '#ef4444', fontWeight: 600 }}>
            {this.props.label ? `${this.props.label} Error` : 'Component Error'}
          </div>
          <div style={{
            fontSize: 10, color: '#94a3b8', maxWidth: 320, lineHeight: 1.5,
            fontFamily: 'JetBrains Mono, monospace',
            padding: '8px 12px', borderRadius: 6,
            background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)',
            maxHeight: 120, overflowY: 'auto',
          }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </div>
          <button onClick={this.handleReset}
            style={{
              padding: '6px 16px', borderRadius: 6, border: '1px solid rgba(139,92,246,0.3)',
              background: 'rgba(139,92,246,0.1)', color: '#a78bfa', fontSize: 11,
              fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
