import { lazy } from 'react'
import { useBoard, useBoardApi } from './workspace.jsx'
import { navigate } from './route.js'

// [[view-registry]]: the map from an address kind to the thing that renders it.
//
// This is the layer the board did not have. Before it, the dashboard was one component that WAS the graph,
// with every other page hung off it as a hidden pane and every page's state held in that one component's
// body. That shape decided three things it should never have decided: reading a spec had to be a popup
// (the popup was a child of the graph), a tab could only switch pages (a page was the only unit), and a
// document area had nowhere to live (there was no content area, only "the graph, plus hidden panes").
//
// A view here obeys one contract: **it receives `{ param, query }` and does not read the global address.**
// That single rule is what lets the shell render two views at once, and what stops a view from coupling
// itself to whichever address happens to be current. Everything else — the board, the workspace — it asks
// for by context, so no component has to own another component's props.

const CHUNK_RELOAD_KEY = 'spexcode.chunk-reload'

// Every view is lazy, and the dashboard ships as a static dist behind a gateway — so a tab can be holding
// an index.html from before a redeploy and ask for hashed chunks that no longer exist. React.lazy caches
// the REJECTION: one 404 and that view is permanently dead for the life of the page, however many times
// the reader navigates back to it. That is why the retry has to live inside the IMPORTER, which is the
// only place a second attempt is still possible. Two retries cover a chunk that is merely slow or still
// landing; if it is genuinely gone, the new index.html is the fix, so we reload once. Once, guarded by
// sessionStorage — a redeploy that keeps failing has to surface in [[workspace-shell]]'s error boundary
// rather than spin the tab. A successful import clears the guard, so the next stale dist gets its reload.
function lazyRetry(importer) {
  return lazy(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const mod = await importer()
        try { sessionStorage.removeItem(CHUNK_RELOAD_KEY) } catch { /* private mode */ }
        return mod
      } catch (err) {
        if (attempt < 2) { await new Promise((done) => setTimeout(done, 250)); continue }
        // no sessionStorage (private mode) reads as "already reloaded" — never risk a reload loop.
        let reloaded = true
        try { reloaded = sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1' } catch { /* keep true */ }
        if (reloaded) throw err
        try { sessionStorage.setItem(CHUNK_RELOAD_KEY, '1') } catch { /* unreachable: read threw first */ }
        location.reload()
        await new Promise(() => {})   // the reload wins; hold the Suspense fallback instead of flashing
      }
    }
  })
}

const GraphView = lazyRetry(() => import('./GraphView.jsx'))
const SpecView = lazyRetry(() => import('./SpecView.jsx'))
const FileView = lazyRetry(() => import('./FileView.jsx'))
const SessionsView = lazyRetry(() => import('./SessionsView.jsx'))
const EvalsPage = lazyRetry(() => import('./EvalsPage.jsx'))
const IssuesPage = lazyRetry(() => import('./IssuesPage.jsx'))
const Settings = lazyRetry(() => import('./Settings.jsx'))
const EmptyView = lazyRetry(() => import('./EmptyView.jsx'))

const openSession = (id) => navigate('sessions', id)

// The three review-side pages already take everything they need as props and hold their own state; they
// become views by reading the board from context instead of from whoever rendered them. No rewrite, and no
// second copy of their data path.
function EvalsView() {
  const { specs, sessions, issuesStamp } = useBoard()
  const { reload } = useBoardApi()
  return <EvalsPage specs={specs} sessions={sessions} issuesStamp={issuesStamp} reloadBoard={reload} onOpenSession={openSession} />
}
function IssuesView() {
  const { specs, sessions, issuesStamp } = useBoard()
  return <IssuesPage specs={specs} sessions={sessions} issuesStamp={issuesStamp} onOpenSession={openSession} />
}
function SettingsView() { return <Settings /> }

// A tab holds an OBJECT, not a board face. `document(page, param)` therefore receives the route selector:
// graph and bare list pages are finding surfaces, while only object-shaped addresses enter the working set.
// `empty` is what the workspace shows when it holds nothing; a tab for it would contradict its own strip.
export const VIEWS = {
  graph:    { component: GraphView,    document: false, className: 'view-graph' },
  spec:     { component: SpecView,     document: (_page, param) => param != null, className: 'view-spec' },
  file:     { component: FileView,     document: (_page, param) => param != null, className: 'view-file' },
  sessions: { component: SessionsView, document: (_page, param) => param != null, className: 'view-sessions' },
  evals:    { component: EvalsView,    document: (_page, param) => param != null, className: 'view-evals' },
  issues:   { component: IssuesView,   document: (_page, param) => param != null, className: 'view-issues' },
  settings: { component: SettingsView, document: false, className: 'view-settings' },
  empty:    { component: EmptyView,    document: false, className: 'view-empty' },
}

export const viewFor = (page) => VIEWS[page] || VIEWS.graph
export const isDocument = (page, param = null) => typeof VIEWS[page]?.document === 'function'
  ? VIEWS[page].document(page, param)
  : !!VIEWS[page]?.document
