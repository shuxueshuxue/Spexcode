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

const GraphView = lazy(() => import('./GraphView.jsx'))
const SpecView = lazy(() => import('./SpecView.jsx'))
const FileView = lazy(() => import('./FileView.jsx'))
const SessionsView = lazy(() => import('./SessionsView.jsx'))
const EvalsPage = lazy(() => import('./EvalsPage.jsx'))
const IssuesPage = lazy(() => import('./IssuesPage.jsx'))
const Settings = lazy(() => import('./Settings.jsx'))

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

// `document: true` marks a view the tab strip may accumulate. `settings` is a destination people bounce off
// rather than a document they keep open, and the graph is the workspace's home rather than one of its
// documents — a strip that filled with either would stop being a list of what you are working on.
export const VIEWS = {
  graph:    { component: GraphView,    document: true,  className: 'view-graph' },
  spec:     { component: SpecView,     document: true,  className: 'view-spec' },
  file:     { component: FileView,     document: true,  className: 'view-file' },
  sessions: { component: SessionsView, document: true,  className: 'view-sessions' },
  evals:    { component: EvalsView,    document: true,  className: 'view-evals' },
  issues:   { component: IssuesView,   document: true,  className: 'view-issues' },
  settings: { component: SettingsView, document: false, className: 'view-settings' },
}

export const viewFor = (page) => VIEWS[page] || VIEWS.graph
export const isDocument = (page) => !!VIEWS[page]?.document
