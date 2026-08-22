import { Component } from 'react'
import { useT } from './i18n/index.jsx'

// [[workspace-shell]]: containment, one surface at a time.
//
// A view that throws must not take the frame with it. The rail, the dock, the tab strip, the status bar
// and the OTHER split pane are not implicated in one document's bug, and a reader who can still navigate
// can still get out — so the boundary sits around each pane, never around the app. Wrapping the app would
// trade a broken document for a white screen, which is the failure this exists to prevent.
//
// This is the only class in the dashboard, and it is a class because React gives it no choice:
// componentDidCatch / getDerivedStateFromError have no hook equivalent. Nothing else here earns one.

class Boundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) { return { error } }

  componentDidCatch(error, info) {
    // fail loudly. A contained crash is still a crash, and the pane's one-line panel is not a report —
    // the console keeps the stack, tagged with which surface it came from.
    console.error(`view crashed (${this.props.resetKey}):`, error, info?.componentStack)
  }

  // The address IS the reset. A boundary that latched would turn one bad document into a pane that stays
  // dead for the rest of the session, even after the reader navigates somewhere healthy — so a changed
  // `resetKey` clears the caught error, and the retry button is the same reset for the case where the
  // address did not change (a transient fetch, a chunk that has since landed).
  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="view-error">
        <div className="view-error-box">
          <p className="view-error-title">{this.props.t('viewError.title')}</p>
          <p className="view-error-detail">{String(error?.message || error)}</p>
          <button type="button" className="view-error-retry" onClick={() => this.setState({ error: null })}>
            {this.props.t('viewError.retry')}
          </button>
        </div>
      </div>
    )
  }
}

// The class cannot call useT(), so the copy arrives as a prop from a function wrapper. The class stays the
// minimum React demands of it and knows nothing about locales.
export default function ViewErrorBoundary({ resetKey, children }) {
  const t = useT()
  return <Boundary resetKey={resetKey} t={t}>{children}</Boundary>
}
