import { useEffect, useState } from 'react'
import SessionInterface from './SessionInterface.jsx'
import { navigate } from './route.js'
import { useBoard, useBoardApi, useWorkspace, useWorkspaceApi } from './workspace.jsx'

// [[sessions-view]]: the live console as a view. It kept every behaviour it had; what changed is where its
// state lives. `sel` used to be held by the component that also held the graph's camera and every other
// page's props — so opening a session re-rendered the graph. Now it is the view's own.
export default function SessionsView({ param }) {
  const { specs, sessions, boardLive } = useBoard()
  const { reload } = useBoardApi()
  const { palette } = useWorkspace()
  const { openPalette, takeCompose } = useWorkspaceApi()
  const [sel, setSel] = useState(() => param || 'new')
  // a board chord may have composed text for this view before it existed; collect it once on arrival.
  const [seed, setSeed] = useState(() => takeCompose())
  useEffect(() => { if (param) setSel(param) }, [param])

  return (
    <SessionInterface
      sessions={sessions}
      specs={specs}
      focusNode={null}
      open
      searchOpen={!!palette}
      sel={sel}
      setSel={setSel}
      seed={seed}
      onSeedConsumed={() => setSeed(null)}
      onClose={() => navigate('graph')}
      onPickSession={(id) => navigate('sessions', id)}
      onOpenSearch={() => openPalette('sessions')}
      boardLive={boardLive}
      reload={reload}
    />
  )
}
