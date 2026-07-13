import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

// Root-level safety net: without this, any uncaught render error (most
// commonly a lazy-chunk `import()` failing on flaky mobile networks, e.g.
// TripInProgress's map chunks right after OTP verify) unmounts the whole
// React tree to a blank white screen with no way back except manual refresh.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    // Stale chunk hash after a deploy — reload once to pick up the new build.
    const message = error instanceof Error ? error.message : String(error)
    if (/dynamically imported module|Loading chunk|Importing a module script failed/i.test(message)) {
      window.location.reload()
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-6 bg-bg text-center">
          <p className="text-text-primary font-bold text-lg">Something went wrong</p>
          <p className="text-text-muted text-sm">Please reload to continue.</p>
          <button
            onClick={() => window.location.reload()}
            className="btn-go px-6"
            style={{ minHeight: 48 }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
