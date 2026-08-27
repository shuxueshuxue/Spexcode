import { useCallback, useEffect, useState } from 'react'
import SessionInterface from './SessionInterface.jsx'
import { useBoard, useBoardApi, usePaneActive, useWorkspace, useWorkspaceApi } from './workspace.jsx'
import { useViewScope } from './ViewScope.jsx'
import { markNewTab } from './tabs.js'

// [[sessions-view]]: the live console as a view. It kept every behaviour it had; what changed is where its
// state lives. `sel` used to be held by the component that also held the graph's camera and every other
// page's props — so opening a session re-rendered the graph. Now it is the view's own.
export default function SessionsView({ param, query }) {
  const { specs, sessions, boardLive } = useBoard()
  const { reload } = useBoardApi()
  const { palette } = useWorkspace()
  const { openPalette, takeCompose, watchCompose } = useWorkspaceApi()
  const scope = useViewScope()
  // A new tab and a plain read differ only in what the workspace is told BEFORE the address is written:
  // the mark is [[tab-strip]]'s, the route write stays this view's ([[workspace-shell]] owns every address
  // a view lands on). The launch page names no session, so it never gets a tab.
  const pickSession = useCallback((id, { newTab = false } = {}) => {
    const route = { page: 'sessions', param: id, query: null }
    if (newTab && id !== 'new') markNewTab(route.page, route.param, route.query)
    return scope.open(route)
  }, [scope])
  const selection = param && param !== 'new' ? param : 'new'
  // a board chord may have composed text for this view before it existed; collect it on arrival — in an
  // EFFECT, never a state initializer. The take is a one-shot, and StrictMode double-invokes initializers
  // to expose exactly that: the first invocation consumed the payload and the second's null won. The
  // null-guard makes the double-run effect idempotent instead.
  //
  // ARRIVAL IS NOT THE ONLY MOMENT A DROP HAPPENS. This view stays mounted once it has been visited
  // ([[workspace-shell]]'s pool), so collecting only on mount means every composition after the first was
  // written into a slot nobody read again. It collects WHILE SHOWING instead: becoming the shown document
  // is the arrival that still happens every time, and it is also the only moment the composer the seed
  // lands in can take focus — a textarea inside a display:none pane cannot. One effect answers both, and a
  // cold mount is unchanged because a freshly mounted pane is already the showing one.
  const [seed, setSeed] = useState(null)
  const showing = usePaneActive()
  useEffect(() => {
    if (typeof query?.seed === 'string' && query.seed.length) setSeed(query.seed)
  }, [query?.seed])
  useEffect(() => {
    if (!showing) return undefined
    const collect = () => { const t = takeCompose(); if (t != null) setSeed(t) }
    collect()
    return watchCompose(collect)
  }, [showing, takeCompose, watchCompose])
  return (
    <SessionInterface
      sessions={sessions}
      specs={specs}
      focusNode={null}
      open={showing}
      searchOpen={!!palette}
      sel={selection}
      surface={query?.surface}
      setSel={pickSession}
      seed={seed}
      onSeedConsumed={() => setSeed(null)}
      onClose={() => scope.open({ page: 'graph', param: null, query: null })}
      onPickSession={pickSession}
      onOpenArchive={() => scope.open({
        page: 'sessions', param: param && param !== 'new' ? param : null, query: { archive: '1' },
      })}
      onOpenSearch={() => openPalette('sessions')}
      boardLive={boardLive}
      reload={reload}
      archiveRequested={query?.archive === '1'}
      route={{ page: 'sessions', param, query }}
    />
  )
}
