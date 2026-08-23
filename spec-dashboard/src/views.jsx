import { lazy } from 'react'
import { useBoard, useBoardApi } from './workspace.jsx'
import { navigate } from './route.js'
import { createViewRegistry } from './viewRegistry.js'

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
// second copy of their data path. The ROUTE comes down the same way — the two boards used to call
// `useRoute` and were the only views breaking the contract above. It went unnoticed while every view was
// unmounted the moment it stopped showing; once documents stay mounted ([[workspace-shell]]'s pool), a
// board still reading the global address would follow the reader into whatever they opened next.
function EvalsView({ param, query }) {
  const { specs, sessions, issuesStamp } = useBoard()
  const { reload } = useBoardApi()
  return <EvalsPage param={param} query={query} specs={specs} sessions={sessions} issuesStamp={issuesStamp} reloadBoard={reload} onOpenSession={openSession} />
}
function IssuesView({ param, query }) {
  const { specs, sessions, issuesStamp } = useBoard()
  return <IssuesPage param={param} query={query} specs={specs} sessions={sessions} issuesStamp={issuesStamp} onOpenSession={openSession} />
}
function SettingsView() { return <Settings /> }

// `surface` selects the host chrome; `document(page, param)` marks what the workspace working set may hold.
// Evals and Issues are resident workspace destinations: their top-level tab is one stable address, while
// a scenario or issue detail is route state shown inside that tab. This keeps the Spec/Session/File working
// set visible while a finding is focused and prevents a detail from replacing an unrelated document slot.
// Graph remains an addressable legacy view, not a top-level tab.
export const VIEWS = Object.freeze({
  // `graph` remains registered and renders direct graph addresses; it is no longer a route the workspace
  // sends anyone through the rail or a tab close.
  graph:    { component: GraphView,    surface: 'workspace', document: false, icon: 'graph', className: 'view-graph' },
  spec:     { component: SpecView,     surface: 'workspace', document: (_page, param) => param != null, icon: 'graph', className: 'view-spec' },
  file:     { component: FileView,     surface: 'workspace', document: (_page, param) => param != null, icon: 'files', className: 'view-file' },
  // `#/sessions/new` is the LAUNCH page, not a document: it names no session, it is where a session is
  // started, and a tab for it would be a tab for a form. Bare `#/sessions` is the same face.
  sessions: { component: SessionsView, surface: 'workspace', document: (_page, param) => param != null && param !== 'new', icon: 'sessions', className: 'view-sessions' },
  // Findings share the workspace shell. `resident` makes the bare top-level address the one tab identity;
  // `tabModel.tabRoute` collapses detail selectors onto it without losing the detail route in the URL.
  evals:    { component: EvalsView,    surface: 'workspace', document: true, resident: true, icon: 'evals', className: 'view-evals' },
  issues:   { component: IssuesView,   surface: 'workspace', document: true, resident: true, icon: 'issues', className: 'view-issues' },
  settings: { component: SettingsView, surface: 'workspace', document: true, resident: true, icon: 'settings', className: 'view-settings' },
  empty:    { component: EmptyView,    surface: 'workspace', document: false, className: 'view-empty' },
})

// Product-owned views are seeded once; extensions register through this boundary so
// collisions and ownership are visible instead of silently replacing shell routes.
export const viewRegistry = createViewRegistry(VIEWS)
export const registerView = (...args) => viewRegistry.registerView(...args)
export const registerPlugin = (plugin) => viewRegistry.registerPlugin(plugin)
export const unregisterPlugin = (id) => viewRegistry.unregisterPlugin(id)

export const viewFor = (page) => viewRegistry.get(page) || viewRegistry.get('sessions')
export const surfaceFor = (page) => viewFor(page).surface || 'workspace'
export const iconFor = (page) => viewRegistry.get(page)?.icon || null
export const isDocument = (page, param = null) => {
  const view = viewRegistry.get(page)
  return typeof view?.document === 'function' ? view.document(page, param) : !!view?.document
}
export const isResident = (page, param = null) => !!viewRegistry.get(page)?.resident && param == null
