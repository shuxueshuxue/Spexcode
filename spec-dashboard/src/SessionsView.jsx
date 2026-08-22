import { useEffect, useState } from 'react'
import SessionInterface from './SessionInterface.jsx'
import { navigate } from './route.js'
import { useBoard, useBoardApi, useWorkspace, useWorkspaceApi } from './workspace.jsx'

// [[sessions-view]]: the live console as a view. It kept every behaviour it had; what changed is where its
// state lives. `sel` used to be held by the component that also held the graph's camera and every other
// page's props — so opening a session re-rendered the graph. Now it is the view's own.
export default function SessionsView({ param, query }) {
  const { specs, sessions, boardLive } = useBoard()
  const { reload } = useBoardApi()
  const { palette } = useWorkspace()
  const { openPalette, takeCompose } = useWorkspaceApi()
  const [sel, setSel] = useState(() => param || 'new')
  // a board chord may have composed text for this view before it existed; collect it on arrival — in an
  // EFFECT, never a state initializer. The take is a one-shot, and StrictMode double-invokes initializers
  // to expose exactly that: the first invocation consumed the payload and the second's null won. The
  // null-guard makes the double-run effect idempotent instead.
  const [seed, setSeed] = useState(null)
  useEffect(() => { const t = takeCompose(); if (t != null) setSeed(t) }, [takeCompose])
  useEffect(() => { if (param) setSel(param) }, [param])

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
