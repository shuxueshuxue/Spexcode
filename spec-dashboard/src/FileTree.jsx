import { useCallback, useEffect, useMemo, useState } from 'react'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { STATUS } from './specMeta.js'
import { navigate } from './route.js'
import { fetchNodeFiles } from './data.js'
import { useResizable } from './useResizable.js'

// [[file-tree]]: the left dock. A spec node is a FOLDER, so the tree that navigates the project is the
// folder tree — the same shape on disk, on the board, and here.
//
// It builds from the board the app already holds rather than a new endpoint: the node list carries `parent`
// and `code:`, which is the whole hierarchy plus every governed file. A tree route would have been a second
// projection of data already in memory, free to disagree with the board about what exists. Only a node's
// attachments are fetched, lazily, on the expand that reveals them.

const kidsOf = (specs) => {
  const kids = new Map()
  for (const s of specs) {
    const key = s.parent || ''
    if (!kids.has(key)) kids.set(key, [])
    kids.get(key).push(s)
  }
  return kids
}

function Row({ depth, onClick, open, hasKids, dot, label, kind, active }) {
  return (
    <button type="button" className={`ft-row ft-${kind}${active ? ' on' : ''}`}
      style={{ paddingLeft: 6 + depth * 11 }} onClick={onClick} data-tip={label}>
      <span className="ft-caret">{hasKids ? (open ? '▾' : '▸') : ''}</span>
      {dot ? <i className="ft-dot" style={{ background: dot }} /> : <span className="ft-dot ft-none" />}
      <span className="ft-label">{label}</span>
    </button>
  )
}

// One node: its own row, then — only while expanded — its governed files, its attachments, and its
// children. Attachments are fetched on first expand and kept, so re-opening a branch is instant and a
// reader who never expands a node never pays for its folder listing.
function NodeRow({ node, depth, kids, focusId, onOpenFile }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState(null)
  useEffect(() => {
    if (!open || files) return undefined
    let live = true
    fetchNodeFiles(node.id).then((f) => live && setFiles(f)).catch(() => live && setFiles([]))
    return () => { live = false }
  }, [open, files, node.id])

  const children = kids.get(node.id) || []
  const governed = (node.code || []).map((c) => c.split('#')[0]).filter((v, i, a) => a.indexOf(v) === i)
  const hasKids = children.length > 0 || governed.length > 0

  return (
    <>
      <Row depth={depth} kind="node" label={node.title || node.id} active={focusId === node.id}
        dot={STATUS[node.status]?.color} hasKids={hasKids} open={open}
        // The row does BOTH: it focuses the node on the board (the address the tree is a view of) and
        // discloses its contents. Splitting them into two hit targets would make the common move — look
        // inside this node — cost two clicks in a list built for scanning.
        onClick={() => { setOpen((v) => !v); navigate('graph', node.id) }} />
      {open && (
        <>
          {governed.map((f) => (
            <Row key={`c:${f}`} depth={depth + 1} kind="code" label={f.split('/').pop()}
              onClick={() => onOpenFile({ kind: 'source', path: f, label: f })} />
          ))}
          {(files || []).map((f) => (
            <Row key={`a:${f.name}`} depth={depth + 1} kind="att" label={f.name}
              onClick={() => onOpenFile({ kind: 'attachment', nodeId: node.id, name: f.name, label: f.name })} />
          ))}
          {children.map((c) => (
            <NodeRow key={c.id} node={c} depth={depth + 1} kids={kids} focusId={focusId} onOpenFile={onOpenFile} />
          ))}
        </>
      )}
    </>
  )
}

export default function FileTree({ specs, focusId, onOpenFile }) {
  const t = useT()
  const [width, onDrag, reset] = useResizable('spex.ftWidth', 232, { min: 180, max: 460 })
  const kids = useMemo(() => kidsOf(specs || []), [specs])
  const roots = kids.get('') || []
  const open = useCallback((f) => onOpenFile?.(f), [onOpenFile])
  if (!specs?.length) return null
  return (
    <div className="filetree" style={{ width }}>
      <div className="ft-head">
        <span>{t('fileTree.title')}</span>
        <span className="ft-count">{specs.length}</span>
      </div>
      <div className="ft-body">
        {roots.map((r) => <NodeRow key={r.id} node={r} depth={0} kids={kids} focusId={focusId} onOpenFile={open} />)}
      </div>
      <div className="ft-resize" onMouseDown={onDrag} onDoubleClick={reset} role="separator" aria-orientation="vertical" />
    </div>
  )
}
