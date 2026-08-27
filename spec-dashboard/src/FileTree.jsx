import { useCallback, useEffect, useMemo, useState } from 'react'
import { Caret, Icon } from './icons.jsx'
import { firesEvent } from './bindings.js'
import ExplorerContextMenu from './ExplorerContextMenu.jsx'
import { STATUS } from './specMeta.js'
import { navigate } from './route.js'
import { isNewTabGesture, openNewTab } from './tabs.js'
import { fetchNodeFiles } from './data.js'
import DiskTree from './DiskTree.jsx'
import { useT } from './i18n/index.jsx'
import { useResizable } from './useResizable.js'
import { DOCK_BAND } from './dockBand.js'
import { revealSpecPath, toggleSpecNode, useSpecTreeState } from './specTreeState.js'

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

// A row declares WHAT IT IS on the element itself (`data-menu-*`). The explorer then needs exactly one
// right-click/keyboard seam for every projection instead of a handler per row kind, and a row that grows
// later joins the menu by naming its subject rather than by wiring anything.
function Row({ depth, onClick, open, hasKids, dot, label, kind, active, subject = null }) {
  return (
    <button type="button" className={`ft-row ft-${kind}${active ? ' on' : ''}`}
      style={{ paddingLeft: 6 + depth * 11, '--depth': depth }} onClick={onClick} data-tip={label}
      data-menu-kind={subject?.kind} data-menu-id={subject?.id} data-menu-path={subject?.path}>
      <span className="ft-caret">{hasKids && <Caret open={open} />}</span>
      {dot ? <i className="ft-dot" style={{ background: dot }} /> : <span className="ft-dot ft-none" />}
      <span className="ft-label">{label}</span>
    </button>
  )
}

// One node: its own row, then — only while expanded — its governed files, its attachments, and its
// children. Attachments are fetched on first expand and kept, so re-opening a branch is instant and a
// reader who never expands a node never pays for its folder listing.
function NodeRow({ node, depth, kids, focusId, onOpenFile }) {
  // disclosure lives in the shared store, not here: a row unmounts whenever an ancestor collapses or the
  // dock folds, and a local flag would be erased by a gesture that had nothing to do with it.
  const { open: openIds } = useSpecTreeState()
  const open = openIds.has(node.id)
  const setOpen = (next) => {
    const value = typeof next === 'function' ? next(open) : next
    if (value !== open) toggleSpecNode(node.id)
  }
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
        subject={{ kind: 'node', id: node.id }}
        dot={STATUS[node.status]?.color} hasKids={hasKids} open={open}
        // The row does BOTH: it focuses the node on the board (the address the tree is a view of) and
        // discloses its contents. Splitting them into two hit targets would make the common move — look
        // inside this node — cost two clicks in a list built for scanning.
        // A plain click opens the node in the focused tab; ctrl/⌘ opens it in a new tab ([[tab-strip]]).
        // Disclosure never opens the governed files it reveals: the node's own document already shows its
        // code, so a click that asked to read a node must not mint a file tab behind it.
        onClick={(e) => {
          setOpen((v) => !v)
          if (isNewTabGesture(e)) openNewTab('spec', node.id)
          else navigate('spec', node.id)
        }} />
      {open && (
        <>
          {governed.map((f) => (
            <Row key={`c:${f}`} depth={depth + 1} kind="code" label={f.split('/').pop()} subject={{ kind: 'file', path: f }}
              onClick={(e) => (isNewTabGesture(e) ? openNewTab : navigate)('file', f)} />
          ))}
          {(files || []).map((f) => (
            <Row key={`a:${f.name}`} depth={depth + 1} kind="att" label={f.name}
              subject={{ kind: 'file', path: `.spec/${node.id}/${f.name}` }}
              onClick={(e) => (isNewTabGesture(e) ? openNewTab : navigate)('file', `.spec/${node.id}/${f.name}`)} />
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
//
// A section head carries NOTHING but its own disclosure. "Collapse folders" acts on both projections at
// once, so it is a door of the explorer and lives on the dock head the two sections share ([[dock-modes]]),
// clearing both ledgers of the one store ([[specTreeState]]); a button nested beside one section's head
// would claim for that section an action that belongs to the list.
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
        <span className="ft-caret"><Caret open={open} /></span>
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
  const [width, onDrag, reset] = useResizable(DOCK_BAND.key, DOCK_BAND.initial, DOCK_BAND)
  const [sections, setSections] = useState(readSections)
  const kids = useMemo(() => kidsOf(specs || []), [specs])
  const roots = kids.get('') || []
  // THE TREE IS A VIEW OF THE ADDRESS, so routing to a node opens the branch that holds it. Without this
  // the explorer could sit on a closed root while a spec document was open beside it — claiming to show
  // where the reader is while showing nothing of the sort. The ANCESTORS open, never the node itself:
  // disclosure means "show me what is inside", and forcing that on arrival would answer a question the
  // reader did not ask and would fight their own collapse of it.
  const parentOf = useMemo(() => {
    const parents = new Map()
    for (const s of specs || []) parents.set(s.id, s.parent || null)
    return parents
  }, [specs])
  useEffect(() => {
    if (!focusId || !parentOf.has(focusId)) return
    const path = []
    for (let id = parentOf.get(focusId), guard = 0; id && guard < 64; id = parentOf.get(id), guard++) path.push(id)
    revealSpecPath(path)
  }, [focusId, parentOf])
  const open = useCallback((f) => onOpenFile?.(f), [onOpenFile])
  const [menu, setMenu] = useState(null)
  // A path's owner is already in the board the tree is built from, so "reveal owning node" needs no lookup
  // route: the first node whose `code:` claims the path IS the answer [[one-govern]] guarantees is single.
  const ownerByPath = useMemo(() => {
    const owners = new Map()
    for (const s of specs || []) {
      for (const claim of s.code || []) {
        const path = claim.split('#')[0]
        if (!owners.has(path)) owners.set(path, s.id)
      }
    }
    return owners
  }, [specs])
  const owningNodeOf = useCallback((path) => ownerByPath.get(path) || null, [ownerByPath])
  // ONE SEAM FOR EVERY PROJECTION. Both trees mount inside this body, so the right-click and the keyboard
  // opener are read here off whichever row the event came from; neither tree grows a menu of its own and a
  // new row kind joins by declaring `data-menu-*`.
  const subjectAt = (target) => {
    const row = target?.closest?.('[data-menu-kind]')
    if (!row) return null
    const { menuKind: kind, menuId: id, menuPath: path } = row.dataset
    return { kind, id: id || null, path: path || null, key: `${kind}:${id || path}`, row }
  }
  const closeMenu = useCallback(() => {
    // A keyboard opening borrowed focus from its row; closing gives it back, so the walk resumes where it
    // was interrupted instead of dropping to the top of the document.
    if (menu?.keyboard) menu.row?.focus?.()
    setMenu(null)
  }, [menu])
  const onRowContextMenu = (event) => {
    const subject = subjectAt(event.target)
    if (!subject) return
    event.preventDefault()
    setMenu({ ...subject, x: event.clientX, y: event.clientY, keyboard: false })
  }
  const onRowKeyDown = (event) => {
    const menuKey = firesEvent('explorer.menu', event)
    if (!menuKey && !firesEvent('explorer.openInNewTab', event)) return
    const subject = subjectAt(event.target)
    if (!subject) return
    event.preventDefault()
    if (menuKey) {
      // anchored to the row, not to a stale pointer: a keyboard menu must appear where the finger is.
      const rect = subject.row.getBoundingClientRect()
      setMenu({ ...subject, x: rect.left + 12, y: rect.bottom, keyboard: true })
      return
    }
    if (subject.kind === 'node') openNewTab('spec', subject.id)
    else if (subject.kind === 'file') openNewTab('file', subject.path)
  }
  const toggle = (key) => setSections((prev) => {
    const next = { ...prev, [key]: !prev[key] }
    try { localStorage.setItem(SECTION_KEY, JSON.stringify(next)) } catch { /* private mode */ }
    return next
  })
  const openSpecGraph = () => {
    // The Spec tab is resident: navigating to its bare address both focuses the open tab and clears any
    // node/file selector. `focusLatestTab` only restored the previous selector, so clicking this graph door
    // appeared inert while a concrete Spec document was already open.
    navigate('spec')
  }
  if (!specs?.length) return null
  return (
    <div className="filetree" style={embedded ? { width: '100%' } : { width }}>
      <div className="ft-body" onContextMenu={onRowContextMenu} onKeyDown={onRowKeyDown}>
        <Section name={t('fileTree.specs')} open={sections.specs} onToggle={() => toggle('specs')}>
          {roots.map((r) => <NodeRow key={r.id} node={r} depth={0} kids={kids} focusId={focusId} onOpenFile={open} />)}
        </Section>
        {/* mounted only while open, so a reader who never opens it never costs the backend a listing */}
        <Section name={t('fileTree.files')} open={sections.files} onToggle={() => toggle('files')}>
          <DiskTree />
        </Section>
      </div>
      <ExplorerContextMenu menu={menu} onClose={closeMenu} owningNodeOf={owningNodeOf} />
      <button type="button" className="ft-graph-entry" data-tip={t('fileTree.graph')} aria-label={t('fileTree.graph')}
        onClick={openSpecGraph}>
        <Icon name="graph" size={14} />
        <span>{t('fileTree.graph')}</span>
      </button>
      {!embedded && <div className="ft-resize" onMouseDown={onDrag} onDoubleClick={reset} role="separator" aria-orientation="vertical" />}
    </div>
  )
}
