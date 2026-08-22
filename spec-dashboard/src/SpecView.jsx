import { useCallback, useEffect, useMemo, useState } from 'react'
import { SpecPane } from './NodeView.jsx'
import SourceView from './SourceView.jsx'
import { fetchNodeFiles, fetchNodeFileSlice } from './data.js'
import { useResizable } from './useResizable.js'
import { useT } from './i18n/index.jsx'
import { useBoard } from './workspace.jsx'

// [[spec-view]]: a spec node read as a DOCUMENT — its prose on the left, the code it governs on the right,
// both there when the document opens.
//
// This is the surface the refactor exists for, and its absence was the refactor's real failure for a while:
// the board grew a status bar, a tab strip and a file dock while reading a spec still meant opening a popup
// over a graph, with the governed file one more click inside that popup. Chrome around the old model is not
// the new model.
//
// The prose renderer is the SAME pane the popup uses, not a second one. A document and a popup showing the
// same node must never be two implementations that can disagree about what the node says; the popup keeps
// its place as a quick lens on board focus, and this is where a node is READ.

// A `code:` entry may name a symbol inside a file, so several entries can point at one file. The document
// opens the FILE and dedupes: the reader wants the file open, not three viewers of it.
const governedPaths = (node) => [...new Set((node?.code || []).map((c) => c.split('#')[0]))]

export default function SpecView({ param }) {
  const t = useT()
  const { specs } = useBoard()
  const node = useMemo(() => specs?.find((s) => s.id === param), [specs, param])
  const paths = useMemo(() => governedPaths(node), [node])
  const [shown, setShown] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [width, onDrag, reset] = useResizable('spex.docSplit', 620, { min: 320, max: 1200, dir: -1 })

  // The right side opens on the node's first governed file. A prose-only node gets no right side at all
  // rather than an empty frame apologising for itself.
  useEffect(() => { setShown(paths[0] || null) }, [param, paths])
  useEffect(() => {
    if (!param) return undefined
    let live = true
    setAttachments([])
    fetchNodeFiles(param).then((f) => live && setAttachments(f)).catch(() => {})
    return () => { live = false }
  }, [param])

  const isAttachment = !!shown && !paths.includes(shown)
  const read = useCallback((offset) => fetchNodeFileSlice(param, shown, offset), [param, shown])

  if (!specs?.length) return <div className="doc-empty">{t('hud.loading')}</div>
  if (!node) return <div className="doc-empty">{t('specView.missing', { id: param })}</div>

  const hasFiles = paths.length > 0 || attachments.length > 0

  // The document's OWN prose already lists what the node governs and carries. Handing those chips the code
  // column ([[node-popup]]'s `viewer` seam) makes them the picker, so the code column is nothing but code —
  // no picker strip above it, no path strip below it, and one place in the document where a file is named.
  return (
    <div className="specview">
      <div className="specview-prose">
        <SpecPane node={node} viewer={hasFiles ? { open: shown, pick: setShown } : null} />
      </div>
      {hasFiles && (
        <>
          <div className="specview-split" onMouseDown={onDrag} onDoubleClick={reset}
            role="separator" aria-orientation="vertical" />
          <div className="specview-code" style={{ width }}>
            {shown && <SourceView key={shown} path={shown} read={isAttachment ? read : undefined} />}
          </div>
        </>
      )}
    </div>
  )
}
