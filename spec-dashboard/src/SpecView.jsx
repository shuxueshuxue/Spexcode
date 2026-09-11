import { useMemo, useRef } from 'react'
import { PendingChanges, SpecPane } from './NodeView.jsx'
import ProseActions from './ProseActions.jsx'
import { useDocumentAction } from './documentActions.jsx'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { routeHash } from './route.js'
import { useViewScope } from './ViewScope.jsx'
import { useBoard } from './workspace.jsx'

// [[spec-view]]: a spec node is a DOCUMENT whose full surface is prose. Governed files and attachments are
// links in that prose; their source lives at an independent file address and is never mounted here.
//
// The prose renderer is the SAME pane the popup uses, not a second one. A document and a popup showing the
// same node must never be two implementations that can disagree about what the node says; the popup keeps
// its place as a quick lens on board focus, and this is where a node is READ.
//
// A node a live worktree is changing has a second face, `?surface=diff`: the same head over the popup's own
// change pane. A ghost (a node only a worktree proposes) has nothing else to read, so it always shows it.

const CHANGE_SURFACE = 'diff'

export default function SpecView({ param, query }) {
  const t = useT()
  const { specs, sessions } = useBoard()
  const scope = useViewScope()
  const node = useMemo(() => specs?.find((s) => s.id === param), [specs, param])
  const proseRef = useRef(null)

  const pending = node?.overlays?.length || 0
  const asked = query?.surface === CHANGE_SURFACE
  const changeFace = !!node?.ghost || asked
  // the toggle stays on the change face after the overlay dissolves, so a landed change never strands the reader
  const toggleable = !!node && !node.ghost && (pending > 0 || asked)
  const toggle = () => scope.open({ page: 'spec', param, query: asked ? null : { surface: CHANGE_SURFACE } }, { replace: true })
  useDocumentAction(routeHash('spec', param, query), toggleable ? {
    id: 'change-switcher', icon: 'git-compare', priority: 79, pressed: asked,
    label: t(asked ? 'specView.changeClose' : 'specView.changeOpen'), onClick: toggle,
  } : null)

  if (!specs?.length) return <div className="doc-empty">{t('hud.loading')}</div>
  if (!node) return <div className="doc-empty">{t('specView.missing', { id: param })}</div>

  const stat = pending > 0 || asked ? (
    <button type="button" className="stat-change" aria-pressed={changeFace} disabled={!toggleable} onClick={toggle}
      data-tip={toggleable ? t(asked ? 'specView.changeClose' : 'specView.changeOpen') : undefined}>
      <Icon name="git-compare" size={12} />{t('specView.pendingChanges', { n: pending })}
    </button>
  ) : null

  return (
    <div className="specview">
      <div className="specview-prose" ref={proseRef}>
        <SpecPane node={node} stat={stat}>{changeFace ? <PendingChanges node={node} sessions={sessions} /> : null}</SpecPane>
        {/* the prose pane's selection layer ([[prose-dispatch]]) — pure z-layers over the reading column,
            so the document's own geometry is exactly what it was without it. Its line addressing is the
            prose's, so the change face carries none. */}
        {!changeFace && <ProseActions node={node} hostRef={proseRef} openSend={query?.send === '1'} />}
      </div>
    </div>
  )
}
