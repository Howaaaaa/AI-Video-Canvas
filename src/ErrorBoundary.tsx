import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

function buildDiagnosticReport(error: Error | null, errorInfo: ErrorInfo | null): string {
  const parts: string[] = [];

  if (error) {
    parts.push(`Error: ${error.message}`);
    parts.push(`\nStack:\n${error.stack || '(no stack)'}`);
  }

  if (errorInfo?.componentStack) {
    parts.push(`\nComponent Stack:\n${errorInfo.componentStack}`);
  }

  parts.push(`\nTimestamp: ${new Date().toISOString()}`);
  parts.push(`User Agent: ${navigator.userAgent}`);

  return parts.join('\n');
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    const report = buildDiagnosticReport(error, errorInfo);
    console.error('ErrorBoundary caught an error:\n', report);

    // Store in sessionStorage for diagnostic access
    try {
      sessionStorage.setItem('__sb_error__', report);
    } catch {
      // Ignore storage errors
    }
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleCopyError = () => {
    const report = buildDiagnosticReport(this.state.error, this.state.errorInfo);
    navigator.clipboard.writeText(report).catch(() => {
      // Fallback: select text in the pre element
    });
  };

  handleClearSettings = () => {
    try {
      localStorage.removeItem('settings-storage');
      sessionStorage.removeItem('__sb_error__');
      window.location.reload();
    } catch {
      // Ignore storage errors
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '32px',
          color: '#e5e5e5',
          fontFamily: 'monospace',
          backgroundColor: '#1a1a1a',
          height: '100%',
          overflow: 'auto',
        }}>
          <h2 style={{ color: '#ef4444', marginBottom: '16px' }}>
            React Rendering Error
          </h2>
          <pre style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            backgroundColor: '#0f0f0f',
            padding: '16px',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '13px',
            color: '#f87171',
          }}>
            {this.state.error?.message}
          </pre>
          {this.state.error?.stack && (
            <pre style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              backgroundColor: '#0f0f0f',
              padding: '16px',
              borderRadius: '8px',
              marginBottom: '16px',
              fontSize: '12px',
              color: '#a3a3a3',
              maxHeight: '300px',
              overflow: 'auto',
            }}>
              {this.state.error.stack}
            </pre>
          )}
          {this.state.errorInfo?.componentStack && (
            <details style={{ marginBottom: '16px' }}>
              <summary style={{ cursor: 'pointer', color: '#a3a3a3', marginBottom: '8px' }}>
                Component Stack
              </summary>
              <pre style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                backgroundColor: '#0f0f0f',
                padding: '16px',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#a3a3a3',
              }}>
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: '8px 16px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Retry
            </button>
            <button
              onClick={this.handleCopyError}
              style={{
                padding: '8px 16px',
                backgroundColor: '#374151',
                color: '#e5e5e5',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Copy Error
            </button>
            <button
              onClick={this.handleClearSettings}
              style={{
                padding: '8px 16px',
                backgroundColor: '#7f1d1d',
                color: '#fca5a5',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Reset Settings & Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
