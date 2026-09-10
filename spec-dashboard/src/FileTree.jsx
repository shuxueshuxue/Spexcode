import { useCallback, useEffect, useMemo, useState } from 'react'
import { PUBLIC_GRAPH_ONLY } from './public-mode.js'
import { Caret, Icon } from './icons.jsx'
import { firesEvent } from './bindings.js'
import ExplorerContextMenu from './ExplorerContextMenu.jsx'
import { STATUS } from './specMeta.js'
import { navigate } from './route.js'
import { isNewTabGesture, openNewTab } from './tabs.js'
import DiskTree from './DiskTree.jsx'
import { useT } from './i18n/index.jsx'
import { useResizable } from './useResizable.js'
import { DOCK_BAND } from './dockBand.js'
import { revealSpecPath, toggleSpecNode, useSpecTreeState } from './specTreeState.js'

// [[file-tree]]: the left dock. A spec node is a FOLDER, so the tree that navigates the project is the
// folder tree — the same shape on disk, on the board, and here.
//
// It builds from the board the app already holds rather than a new endpoint: the node list carries `parent`,
// which is the whole hierarchy. A tree route would have been a second projection of data already in memory,
// free to disagree with the board about what exists. Nothing is fetched here: a node is one row, and its files
// belong to its document and to the Files projection ([[disk-tree]]).

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
//
// TWO HANDS ON ONE ROW. The label is the address: clicking it opens the node's document and nothing else.
// The caret is the hinge: clicking it discloses the branch and nothing else. They used to be one target,
// and every click that meant "read this node" also blew its branch open under the pointer and shoved the
// rest of the list down — the list moved while the reader was scanning it. A folder that only opens when
// its hinge is pressed stays where the reader left it ([[file-tree]]). A leaf keeps the caret's slot
// empty so labels stay in one column.
function Row({ depth, onOpen, onToggle, open, hasKids, mark, label, toggleLabel, kind, active, onPath, subject = null }) {
  return (
    <div className={`ft-row ft-${kind}${active ? ' on' : ''}${onPath ? ' path' : ''}`}
      style={{ paddingLeft: 6 + depth * 11, '--depth': depth }}
      data-menu-kind={subject?.kind} data-menu-id={subject?.id} data-menu-path={subject?.path}>
      {hasKids
        ? <button type="button" className="ft-caret" aria-expanded={open} aria-label={toggleLabel} onClick={onToggle}><Caret open={open} /></button>
        : <span className="ft-caret ft-caret-none" aria-hidden="true" />}
      <button type="button" className="ft-label" onClick={onOpen} data-tip={label}>{label}</button>
      {/* the one mark a row may wear: a node being worked on now, or one whose code has moved on without it.
          Settled nodes wear nothing — a square on every row was a bullet, not a signal. */}
      {mark && <i className={`ft-mark ft-mark-${mark}`} />}
    </div>
  )
}

// One node is ONE ROW — a folder that is the object itself. Its children are the only things listed
// beneath it. The files a node governs and the attachments in its folder are not rows here: the node's own
// document already shows its code and its folder, and the Files projection lists the disk as the disk
// ([[disk-tree]]). Listing them a third time here made the tree a file browser wearing a spec tree's
// clothes, and doubled the rows a reader had to scan past to reach the next node.
function NodeRow({ node, depth, kids, focusId, pathIds }) {
  const t = useT()
  // disclosure lives in the shared store, not here: a row unmounts whenever an ancestor collapses or the
  // dock folds, and a local flag would be erased by a gesture that had nothing to do with it.
  const { open: openIds } = useSpecTreeState()
  const open = openIds.has(node.id)
  const children = kids.get(node.id) || []
  const hasKids = children.length > 0
  const mark = node.status === 'active' ? 'active' : node.drift > 0 || node.status === 'drift' ? 'drift' : null
  return (
    <>
      <Row depth={depth} kind="node" label={node.title || node.id} active={focusId === node.id} onPath={pathIds.has(node.id)}
        subject={{ kind: 'node', id: node.id }} mark={mark} hasKids={hasKids} open={open}
        toggleLabel={t('fileTree.disclose', { name: node.title || node.id })}
        onToggle={() => toggleSpecNode(node.id)}
        // A plain click opens the node in the focused tab; ctrl/⌘ opens it in a new tab ([[tab-strip]]).
        onOpen={(e) => (isNewTabGesture(e) ? openNewTab : navigate)('spec', node.id)} />
      {open && children.map((c) => (
        <NodeRow key={c.id} node={c} depth={depth + 1} kids={kids} focusId={focusId} pathIds={pathIds} />
      ))}
    </>
  )
}

// SPECS and FILES are two projections of one explorer, always present and identified by static zone heads.
// Their rows own the only disclosures: spec nodes and disk directories expand independently, while the
// explorer head's collapse-folders door can clear both ledgers together ([[dock-modes]]).
function Section({ name, count, tone, children }) {
  return (
    <section className="ft-section">
      <div className={`ft-section-head si-zone si-zone-${tone}`} role="heading" aria-level="2">
        <span className="si-zone-label ft-section-name">{name}</span>
        <span className="si-zone-count" aria-hidden="true">{count}</span>
      </div>
      <div className="ft-section-body">{children}</div>
    </section>
  )
}

// The tree names itself through the dock's one header row ([[dock-modes]]), not through a strip of its own:
// "Explorer, 355" belongs to the dock that is currently projecting the explorer, and a projection that
// re-declares its own name is the second answer to a question already answered one row above. The two
// The two zone heads below name the projections inside the list, not the list itself.
export default function FileTree({ specs, focusId, embedded = false }) {
  const t = useT()
  const [width, onDrag, reset] = useResizable(DOCK_BAND.key, DOCK_BAND.initial, DOCK_BAND)
  const [fileCount, setFileCount] = useState(0)
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
  const pathIds = useMemo(() => {
    const ids = new Set()
    if (!focusId || !parentOf.has(focusId)) return ids
    for (let id = parentOf.get(focusId), guard = 0; id && guard < 64; id = parentOf.get(id), guard++) ids.add(id)
    return ids
  }, [focusId, parentOf])
  useEffect(() => {
    const path = [...pathIds]
    if (path.length) revealSpecPath(path)
  }, [pathIds])
  const sendNode = useCallback((id) => navigate('spec', id, { query: { send: '1' } }), [])
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
  const onFileCount = useCallback((count) => setFileCount(count), [])
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
        <Section name={t('fileTree.specs')} count={specs.length} tone="specs">
          {roots.map((r) => <NodeRow key={r.id} node={r} depth={0} kids={kids} focusId={focusId} pathIds={pathIds} />)}
        </Section>
        {/* A published tree ships the spec index and its documents, never the repository's source. Offering
            an empty Files section there would name a capability the payload cannot answer. */}
        {!PUBLIC_GRAPH_ONLY && (
          <Section name={t('fileTree.files')} count={fileCount} tone="files">
            <DiskTree onCount={onFileCount} />
          </Section>
        )}
      </div>
      <ExplorerContextMenu menu={menu} onClose={closeMenu} owningNodeOf={owningNodeOf} onSend={sendNode} />
      <button type="button" className="ft-graph-entry" data-tip={t('fileTree.graph')} aria-label={t('fileTree.graph')}
        onClick={openSpecGraph}>
        <Icon name="graph" size={14} />
        <span>{t('fileTree.graph')}</span>
      </button>
      {!embedded && <div className="ft-resize" onMouseDown={onDrag} onDoubleClick={reset} role="separator" aria-orientation="vertical" />}
    </div>
  )
}
