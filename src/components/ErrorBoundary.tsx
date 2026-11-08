import { Component, type ErrorInfo, type ReactNode } from 'react'
import './ErrorBoundary.css'

interface ErrorBoundaryProps {
  children: ReactNode
  /** What failed, for the heading: "The viewer", "VoxNote". */
  label: string
  /** Reloads the page; injectable for tests. */
  onReload?: () => void
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Catches a render error below it and shows it with a Reload button instead
 * of a blank page. It never touches local storage: saved annotations, the
 * kept document and the draft are all still there after the reload.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Loud on purpose: the stack belongs in the console for a bug report.
    console.error(`${this.props.label} crashed:`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const reload = this.props.onReload ?? (() => window.location.reload())
    return (
      <div role="alert" className="error-boundary">
        <h2>{this.props.label} stopped because of an error</h2>
        <p className="error-boundary-message">{error.message}</p>
        <p>
          Your saved annotations, the open document and any unsaved draft are
          kept on this device. Reload to continue where you were.
        </p>
        <button type="button" className="is-primary" onClick={reload}>
          Reload
        </button>
      </div>
    )
  }
}
