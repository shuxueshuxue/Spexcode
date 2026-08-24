import { useEffect, useState } from 'react'
import SessionInterface from './SessionInterface.jsx'
import { navigate } from './route.js'
import { useBoard, useBoardApi, usePaneActive, useWorkspace, useWorkspaceApi } from './workspace.jsx'

// [[sessions-view]]: the live console as a view. It kept every behaviour it had; what changed is where its
// state lives. `sel` used to be held by the component that also held the graph's camera and every other
// page's props — so opening a session re-rendered the graph. Now it is the view's own.
export default function SessionsView({ param, query }) {
  const { specs, sessions, boardLive } = useBoard()
  const { reload } = useBoardApi()
  const { palette } = useWorkspace()
  const { openPalette, takeCompose, watchCompose } = useWorkspaceApi()
  const [sel, setSel] = useState(() => param || 'new')
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
  // The console is ONE mounted document for every session ([[workspace-shell]]'s pool keys it by page), so
  // the selection has to follow the route in both directions: an id selects that session, and the bare or
  // `new` address selects the launch face. Only the first was needed while every session switch remounted
  // this view — and that remount is exactly what made a switch cost a cold boot.
  useEffect(() => { setSel(param && param !== 'new' ? param : 'new') }, [param])

  return (
    <SessionInterface
      sessions={sessions}
      specs={specs}
      focusNode={null}
      open
      searchOpen={!!palette}
      sel={sel}
      surface={query?.surface}
      setSel={setSel}
      seed={seed}
      onSeedConsumed={() => setSeed(null)}
      onClose={() => navigate('graph')}
      onPickSession={(id) => navigate('sessions', id)}
      onOpenSearch={() => openPalette('sessions')}
      boardLive={boardLive}
      reload={reload}
      archiveRequested={query?.archive === '1'}
    />
  )
}
