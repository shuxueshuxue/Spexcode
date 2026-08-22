import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

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

const WorkspaceState = createContext(null)  // { dock, palette }
const WorkspaceApi = createContext(null)    // { setDock, openPalette, closePalette, compose, takeCompose }

const DOCK_KEY = 'spexcode.dock'

export function WorkspaceProvider({ children }) {
  const [dock, setDockState] = useState(() => {
    try { return localStorage.getItem(DOCK_KEY) === '1' } catch { return false }
  })
  // The search palette floats above whichever view is showing, so it is the shell's, not a view's. A view
  // that wants it says so; it does not own it, and a view being hidden can never swallow it.
  const [palette, setPalette] = useState(null)   // null | 'nodes' | 'sessions'
  // A one-shot handoff between views: a board chord composes text that the sessions view should open with.
  // It lives here rather than in either view because neither should have to be mounted for the other to
  // hand it something. A ref, not state — writing it must not re-render the shell.
  const compose = useRef(null)

  const api = useMemo(() => ({
    setDock: (v) => setDockState((prev) => {
      const next = typeof v === 'function' ? v(prev) : v
      try { localStorage.setItem(DOCK_KEY, next ? '1' : '0') } catch { /* private mode */ }
      return next
    }),
    openPalette: (mode) => setPalette(mode),
    closePalette: () => setPalette(null),
    setCompose: (text) => { compose.current = text },
    takeCompose: () => { const t = compose.current; compose.current = null; return t },
  }), [])

  const state = useMemo(() => ({ dock, palette }), [dock, palette])
  return (
    <WorkspaceApi.Provider value={api}>
      <WorkspaceState.Provider value={state}>{children}</WorkspaceState.Provider>
    </WorkspaceApi.Provider>
  )
}

export const useWorkspace = () => useContext(WorkspaceState) || {}
export const useWorkspaceApi = () => useContext(WorkspaceApi) || {}

// A guard the shell asserts in development: a view must not read the global address. It receives its route
// as props, because that is what lets the shell render two of them at once, and what stops a view from
// silently coupling itself to whichever address happens to be current.
export const VIEW_ROUTE_CONTRACT =
  'a view receives { param, query } as props and must not call useRoute()'
