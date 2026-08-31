import { useMemo, useRef } from 'react'
import { SpecPane } from './NodeView.jsx'
import ProseActions from './ProseActions.jsx'
import { useT } from './i18n/index.jsx'
import { useBoard } from './workspace.jsx'

// [[spec-view]]: a spec node is a DOCUMENT whose full surface is prose. Governed files and attachments are
// links in that prose; their source lives at an independent file address and is never mounted here.
//
// The prose renderer is the SAME pane the popup uses, not a second one. A document and a popup showing the
// same node must never be two implementations that can disagree about what the node says; the popup keeps
// its place as a quick lens on board focus, and this is where a node is READ.

export default function SpecView({ param }) {
  const t = useT()
  const { specs } = useBoard()
  const node = useMemo(() => specs?.find((s) => s.id === param), [specs, param])
  const proseRef = useRef(null)

  if (!specs?.length) return <div className="doc-empty">{t('hud.loading')}</div>
  if (!node) return <div className="doc-empty">{t('specView.missing', { id: param })}</div>

  return (
    <div className="specview">
      <div className="specview-prose" ref={proseRef}>
        <SpecPane node={node} />
        {/* the prose pane's selection layer ([[prose-dispatch]]) — pure z-layers over the reading column,
            so the document's own geometry is exactly what it was without it. */}
        <ProseActions node={node} hostRef={proseRef} />
      </div>
    </div>
  )
}
