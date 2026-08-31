import { createContext, useContext, useMemo, useRef, useState } from 'react'

// [[workspace-shell]]'s two contexts. Every context in this app is split the same way and for the same
// measured reason: a value that mixes a stable API with changing state makes the API's identity change
// whenever the state does, and anything that depends on that identity — an effect, a memo, a registration —
// re-runs for reasons that have nothing to do with it. That is not a style preference. It cost an idle tab
// 9.9 seconds of script per 10 seconds of wall clock, because a registry did exactly this and the things
// re-running were its own registrants.
//
//   · the API context holds only functions, memoised on nothing that changes.
//   · the STATE context holds the values, and only the components that render them subscribe.

const BoardState = createContext(null)     // { specs, sessions, issuesStamp, boardLive, identity, catalog, graphOnly }
const BoardApi = createContext(null)       // { reload }

export function BoardProvider({ value, reload, children }) {
  const api = useMemo(() => ({ reload }), [reload])
  return (
    <BoardApi.Provider value={api}>
      <BoardState.Provider value={value}>{children}</BoardState.Provider>
    </BoardApi.Provider>
  )
}
// The board a view reads. A view asks for the data it needs instead of receiving it through whoever
// happened to render it — which is what let one component end up owning every page's props.
export const useBoard = () => useContext(BoardState) || {}
export const useBoardApi = () => useContext(BoardApi) || {}

// ---------------------------------------------------------------------------------------------------

const WorkspaceState = createContext(null)  // { dock, dockMode, palette, split, lockedSource, helpOpen }
const WorkspaceApi = createContext(null)    // { setDock, openPalette, closePalette, toggleHelp, closeHelp, setCompose, takeCompose, watchCompose, splitTo, closeSplit, lockGraphTo }

const DOCK_KEY = 'spexcode.dock'
const DOCK_MODE_KEY = 'spexcode.dockMode'
const SPLIT_KEY = 'spexcode.split'

export function WorkspaceProvider({ children }) {
  // The dock starts OPEN. It is how a reader finds a document without already knowing its address, and a
  // workspace whose only entrance is a URL is a workspace nobody enters — which is exactly what shipping
  // the document view behind a closed dock produced.
  const [dock, setDockState] = useState(() => {
    try { return localStorage.getItem(DOCK_KEY) !== '0' } catch { return true }
  })
  const [dockMode, setDockModeState] = useState(() => {
    try { return localStorage.getItem(DOCK_MODE_KEY) === 'sessions' ? 'sessions' : 'explorer' } catch { return 'explorer' }
  })
  // The search palette floats above whichever view is showing, so it is the shell's, not a view's. A view
  // that wants it says so; it does not own it, and a view being hidden can never swallow it.
  const [palette, setPalette] = useState(null)   // null | 'nodes' | 'sessions'
  // The SECOND view. Two documents at once was the thing the old shape could not express at any price: every
  // page read the global address, so there was only ever one answer to "what is showing". Now a view is
  // handed its route, so a second one is a second route and a place to put it — a layout change, not a
  // rewrite. It is workspace state because it is true of the window, not of either document in it.
  const [split, setSplitState] = useState(() => {
    try { const raw = JSON.parse(localStorage.getItem(SPLIT_KEY) || 'null'); return raw?.page ? raw : null } catch { return null }
  })
  // WHICH SESSION OWNS THE GRAPH. A lock scopes the board to one worktree: its nodes stay lit and every
  // other node dims. It is workspace state for the same reason the split is — it is true of the WINDOW, and
  // the surface that SETS it (a session row in the finding dock) is never the surface that shows it (the
  // graph). Holding it inside the graph is what forced the graph to grow a second session list of its own
  // just to have somewhere to click, and that list is what this replaces. Not persisted: a lock is a way of
  // looking at the board right now, not a preference to inherit on the next boot.
  const [lockedSource, setLockedSource] = useState(null)
  // Help is shell chrome, not graph-local state: the same registry-backed legend remains reachable after routing.
  const [helpOpen, setHelpOpen] = useState(false)
  // A one-shot handoff between views: a board chord composes text that the sessions view should open with.
  // It lives here rather than in either view because neither should have to be mounted for the other to
  // hand it something. A ref, not state — writing it must not re-render the shell.
  //
  // A DROP MUST ANNOUNCE ITSELF, because the receiver is no longer born on arrival. The take used to run
  // once, when the sessions view mounted, which was the whole of the handoff while every navigation to the
  // console mounted a fresh one. The mounted-document pool ([[workspace-shell]]) keeps that view WARM, so a
  // second composition after the first visit had nobody left to collect it and "select prose → new session"
  // silently opened an empty composer. The slot therefore carries watchers: writing it wakes whoever is
  // holding, and a receiver that is not yet mounted still collects on arrival exactly as before.
  const compose = useRef(null)
  const composeWatchers = useRef(new Set())

  const api = useMemo(() => ({
    setDock: (v) => setDockState((prev) => {
      const next = typeof v === 'function' ? v(prev) : v
      try { localStorage.setItem(DOCK_KEY, next ? '1' : '0') } catch { /* private mode */ }
      return next
    }),
    setDockMode: (next) => setDockModeState((prev) => {
      const mode = next === 'sessions' ? 'sessions' : 'explorer'
      try { localStorage.setItem(DOCK_MODE_KEY, mode) } catch { /* private mode */ }
      return mode === prev ? prev : mode
    }),
    openPalette: (mode) => setPalette(mode),
    closePalette: () => setPalette(null),
    toggleHelp: () => setHelpOpen((open) => !open),
    closeHelp: () => setHelpOpen(false),
    setCompose: (text) => {
      compose.current = text
      for (const watcher of [...composeWatchers.current]) watcher()
    },
    takeCompose: () => { const t = compose.current; compose.current = null; return t },
    watchCompose: (fn) => {
      composeWatchers.current.add(fn)
      return () => { composeWatchers.current.delete(fn) }
    },
    splitTo: (route) => setSplitState(() => {
      const next = route?.page ? { page: route.page, param: route.param ?? null, query: route.query ?? null } : null
      try { localStorage.setItem(SPLIT_KEY, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    }),
    closeSplit: () => setSplitState(() => {
      try { localStorage.removeItem(SPLIT_KEY) } catch { /* private mode */ }
      return null
    }),
    // toggle: asking again for the session that already owns the graph releases it.
    lockGraphTo: (source, { toggle = true } = {}) => setLockedSource((prev) => (toggle && prev === source ? null : source || null)),
  }), [])

  const state = useMemo(() => ({ dock, dockMode, palette, split, lockedSource, helpOpen }), [dock, dockMode, palette, split, lockedSource, helpOpen])
  return (
    <WorkspaceApi.Provider value={api}>
      <WorkspaceState.Provider value={state}>{children}</WorkspaceState.Provider>
    </WorkspaceApi.Provider>
  )
}

export const useWorkspace = () => useContext(WorkspaceState) || {}
export const useWorkspaceApi = () => useContext(WorkspaceApi) || {}

// ---------------------------------------------------------------------------------------------------

// THE PANE a view is mounted in ([[workspace-shell]]'s mounted-document pool). Two facts, and both are
// facts a view cannot work out for itself once documents stay mounted while hidden:
//
//   · `address` — the address THIS pane holds, which is not the window's address when the pane is hidden.
//     Anything that remembers something per-address (scroll position) must key on the pane, or a hidden
//     pane will happily write its state over the visible one's.
//   · `active` — whether this pane is the one showing. A hidden document must not hold the keyboard, and
//     must not keep polling for a screen nobody is looking at.
//
// Absent (no provider) means "the whole window is this pane": the phone face, the projects hub, the cold
// review fast-path and the sealed public build all render one view and nothing else.
const Pane = createContext(null)
// A HIDDEN DOCUMENT SEES THE BOARD IT WAS HIDDEN WITH. The board arrives by push and a busy project pushes
// constantly; every push re-renders every subscriber, so a pool of mounted documents would multiply the
// cost of data nobody is looking at by the number of tabs the reader keeps. Freezing the value a hidden
// pane sees is half of what makes the pool free — the other half is the shell not re-rendering the pane at
// all ([[workspace-shell]]); each alone does nothing, because a subtree re-renders if EITHER its props or
// its context moved. Showing a pane hands it the live board again, so it catches up in the render that
// reveals it, which is what a reader expects of a tab they have just come back to.
export function PaneProvider({ value, children }) {
  const board = useContext(BoardState)
  const held = useRef(board)
  if (value.active) held.current = board
  return (
    <Pane.Provider value={value}>
      <BoardState.Provider value={value.active ? board : held.current}>{children}</BoardState.Provider>
    </Pane.Provider>
  )
}
// the two questions with their no-provider answers, so callers do not each invent a default.
export const usePaneActive = () => useContext(Pane)?.active !== false
export const usePaneAddress = () => useContext(Pane)?.address ?? null
