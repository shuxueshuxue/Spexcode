import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from './icons.jsx'
import { STATUS } from './specMeta.js'
import { navigate } from './route.js'
import { pinTab } from './tabs.js'
import { fetchNodeFiles } from './data.js'
import DiskTree from './DiskTree.jsx'
import { useT } from './i18n/index.jsx'
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

function Row({ depth, onClick, onDoubleClick, open, hasKids, dot, label, kind, active }) {
  return (
    <button type="button" className={`ft-row ft-${kind}${active ? ' on' : ''}`}
      style={{ paddingLeft: 6 + depth * 11 }} onClick={onClick} onDoubleClick={onDoubleClick} data-tip={label}>
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
        // A plain click opens the node in the current slot; ctrl/⌘ or a double-click holds it ([[tab-strip]]).
        // Disclosure never opens the governed files it reveals: the node's own document already shows its
        // code, so a click that asked to read a node must not mint a file tab behind it.
        onClick={(e) => {
          setOpen((v) => !v)
          if (e.ctrlKey || e.metaKey) pinTab('spec', node.id)
          else navigate('spec', node.id)
        }} onDoubleClick={() => pinTab('spec', node.id)} />
      {open && (
        <>
          {governed.map((f) => (
            <Row key={`c:${f}`} depth={depth + 1} kind="code" label={f.split('/').pop()}
              onClick={(e) => (e.ctrlKey || e.metaKey ? pinTab : navigate)('file', f)}
              onDoubleClick={() => pinTab('file', f)} />
          ))}
          {(files || []).map((f) => (
            <Row key={`a:${f.name}`} depth={depth + 1} kind="att" label={f.name}
              onClick={() => navigate('spec', node.id)} />
          ))}
          {children.map((c) => (
            <NodeRow key={c.id} node={c} depth={depth + 1} kids={kids} focusId={focusId} onOpenFile={onOpenFile} />
          ))}
        </>
      )}
    </>
  )
}

// THE EXPLORER HAS TWO DISCLOSURES, and they are two PROJECTIONS of one project rather than two features.
// SPECS is the tree above — the project shaped the way this product is about it, and it stays open by
// default because it is the main body of the explorer, not one option among two. FILES is the disk, listed
// as the disk ([[disk-tree]]), closed by default: it answers the other thing a reader does constantly —
// open a file whose location they know — which the spec tree cannot answer, because a path only appears
// there if some node happens to claim it.
//
// A SECTION IS NOT A BAND. Each is a `<section>` whose head is its own disclosure control, which is what
// [[ui-state-model]]'s classifier calls a collapsible payload rather than chrome: the dock stays one band
// ([[dock-modes]]) however many projections it discloses, because these rows scroll with the content they
// head instead of standing between the window edge and it.
const SECTION_KEY = 'spexcode.ftSections'
const readSections = () => {
  try {
    const value = JSON.parse(localStorage.getItem(SECTION_KEY) || 'null')
    return { specs: value?.specs !== false, files: value?.files === true }
  } catch { return { specs: true, files: false } }
}

function Section({ name, open, onToggle, children }) {
  return (
    <section className="ft-section">
      <button type="button" className="ft-section-head" aria-expanded={open} onClick={onToggle}>
        <span className="ft-caret">{open ? '▾' : '▸'}</span>
        <span className="ft-section-name">{name}</span>
      </button>
      {open && <div className="ft-section-body">{children}</div>}
    </section>
  )
}

// The tree names itself through the dock's one header row ([[dock-modes]]), not through a strip of its own:
// "Explorer, 355" belongs to the dock that is currently projecting the explorer, and a projection that
// re-declares its own name is the second answer to a question already answered one row above. The two
// SECTION heads below are a different thing: they name a disclosure inside the list, not the list.
export default function FileTree({ specs, focusId, onOpenFile, embedded = false }) {
  const t = useT()
  const [width, onDrag, reset] = useResizable('spex.ftWidth', 232, { min: 180, max: 460 })
  const [sections, setSections] = useState(readSections)
  const kids = useMemo(() => kidsOf(specs || []), [specs])
  const roots = kids.get('') || []
  const open = useCallback((f) => onOpenFile?.(f), [onOpenFile])
  const toggle = (key) => setSections((prev) => {
    const next = { ...prev, [key]: !prev[key] }
    try { localStorage.setItem(SECTION_KEY, JSON.stringify(next)) } catch { /* private mode */ }
    return next
  })
  if (!specs?.length) return null
  return (
    <div className="filetree" style={embedded ? { width: '100%' } : { width }}>
      <div className="ft-body">
        <Section name={t('fileTree.specs')} open={sections.specs} onToggle={() => toggle('specs')}>
          {roots.map((r) => <NodeRow key={r.id} node={r} depth={0} kids={kids} focusId={focusId} onOpenFile={open} />)}
        </Section>
        {/* mounted only while open, so a reader who never opens it never costs the backend a listing */}
        <Section name={t('fileTree.files')} open={sections.files} onToggle={() => toggle('files')}>
          <DiskTree />
        </Section>
      </div>
      {!embedded && <div className="ft-resize" onMouseDown={onDrag} onDoubleClick={reset} role="separator" aria-orientation="vertical" />}
    </div>
  )
}
