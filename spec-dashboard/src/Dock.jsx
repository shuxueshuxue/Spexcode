import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FileTree from './FileTree.jsx'
import SessionContextMenu from './SessionContextMenu.jsx'
import { SessionConsoleTreeRow, useFold } from './SessionWindow.jsx'
import { sessionAncestorIds, sessionForest, sessionZone } from './session.js'
import { apiFetch } from './data.js'
import { elementAt, startDrag } from './dragGesture.js'
import { navigate } from './route.js'
import { pinTab } from './tabs.js'
import { useT } from './i18n/index.jsx'
import { withShortcut } from './bindings.js'
import { Icon } from './icons.jsx'
import { useResizable } from './useResizable.js'
import { useTransientNotice } from './TransientNotice.jsx'
import { useBoardApi, useWorkspace, useWorkspaceApi } from './workspace.jsx'
import { useBackendHealth } from './BackendStatus.jsx'

// [[dock-modes]]: one finding dock, two projections. Shell owns mode persistence; this component renders
// the selected projection and keeps every row on the existing route/tab contracts.
//
// THE DOCK IS ONE BAND. A projection may not mint chrome of its own: the name, the tally and the doors all
// live in the single header row below, so switching projection changes what the dock LISTS and never how
// thick the dock is. Explorer's count row, the sessions "+" and the archive door were three separate strips
// stacked around one list; that is three answers to a question the shell already answers once.
function SessionDock({ sessions, activeId }) {
  const t = useT()
  const { offline } = useBackendHealth()
  const { expanded, toggle, expand } = useFold()
  const { lockedSource } = useWorkspace()
  const { lockGraphTo } = useWorkspaceApi()
  const { reload } = useBoardApi()
  const { notify } = useTransientNotice()
  const [offlineOpen, setOfflineOpen] = useState(false)
  // A session row's right-click menu belongs to the surface that LISTS sessions. It moved here with the
  // rows when the console's own list was retired, and for one release nothing brought it along: the rows
  // carried a click and nothing else, so rename/attach/lock/close had no pointer route left at all.
  const [menu, setMenu] = useState(null)
  // A ROW IN HAND: `{ id, parent, target }`, where target is the landing under the pointer —
  // `undefined` nothing, `null` the top level, `'archive'` the archive door, or another row's id.
  const [drag, setDrag] = useState(null)
  const [closeRequest, setCloseRequest] = useState(null)   // a row dropped on the archive door, awaiting its confirm
  const abandon = useRef(null)
  useEffect(() => () => abandon.current?.(), [])
  // Reveal follows the focused document, like an editor's active-file explorer: the row remains selected from
  // the route while its parent chain is opened in the dock's existing fold state. Offline is a zone fold, so an
  // active document there opens that disclosure too; no second selection state is needed.
  useEffect(() => {
    if (!activeId) return
    const active = (sessions || []).find((session) => session.id === activeId)
    expand(sessionAncestorIds(sessions || [], activeId))
    if (active && sessionZone(active) === 'offline') setOfflineOpen(true)
  }, [activeId, sessions, expand])
  const rows = useMemo(() => sessionForest(sessions || [], (id) => expanded.has(id), {
    zoneFolded: (zone) => zone === 'offline' && !offlineOpen,
    keepVisible: (session) => session.id === activeId,
  }), [sessions, expanded, offlineOpen, activeId])

  // THE MOVE ITSELF is the backend's existing reparent, for both directions: a row dropped on another row
  // names that row as the parent, and a row dropped on the top-level door names none. There is no second
  // notion of "detach" — the top level is the parent `null`, which is what it already was in the record.
  const changeParent = useCallback(async (childId, parent) => {
    const child = (sessions || []).find((session) => session.id === childId)
    if (!child || (child.parent || null) === parent) return
    try {
      const response = await apiFetch('/api/sessions/reparent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ children: [childId], parent }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.ok === false) throw new Error(body?.error || `session parent update refused (HTTP ${response.status})`)
      // open the new parent, or the row the reader just moved would vanish into a folded subtree
      if (parent) expand([parent])
      reload?.()
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), { kind: 'error' })
    }
  }, [sessions, expand, reload, notify])

  // WHAT THE POINTER IS OVER, asked of the document rather than of the event ([[drag-gesture]]): while a
  // drag is live the window holds the pointer, so the event target is still the row the press began on.
  // Three landings refuse themselves — a row onto itself, a row onto its own descendant (which would make
  // a cycle out of a tree), and a row onto the parent it already has — and each refusal reads as "no
  // landing here", so the marker stays dark and a release does nothing.
  //
  // THE GAP BELOW THE ROWS IS THE TOP LEVEL. A tree has nowhere to point at "no parent", so the list's own
  // empty space answers for it: inside the list and on no row means out of the subtree. It is the one
  // target that costs nothing — the first version put a dashed strip at the head of the list when a drag
  // began, which pushed every row down by its own height at the exact moment the reader was aiming at one,
  // and the row they were reaching for moved out from under the pointer.
  const landingAt = (point, held) => {
    if (elementAt(point.x, point.y, '[data-session-archive-drop]')) return 'archive'
    const row = elementAt(point.x, point.y, '[data-session-drop-id]')
    if (row) {
      const id = row.dataset.sessionDropId
      if (id === held.id || id === held.parent) return undefined
      return sessionAncestorIds(sessions || [], id).includes(held.id) ? undefined : id
    }
    return held.parent && elementAt(point.x, point.y, '[data-session-root-drop]') ? null : undefined
  }

  const startRowDrag = (event, session) => {
    const held = { id: session.id, parent: session.parent || null }
    // the window wears the KIND of drag as well as the gesture, so the archive door can arm itself from CSS
    // instead of the head and the list having to share a piece of state to say "something is in hand".
    const wear = (on) => document.body.classList.toggle('is-session-dragging', on)
    const track = (point) => {
      const target = landingAt(point, held)
      setDrag((prev) => (prev && prev.id === held.id && prev.target === target ? prev : { ...held, target }))
    }
    const settle = () => { wear(false); setDrag(null); abandon.current = null }
    abandon.current = startDrag(event, {
      onStart: (point) => { wear(true); track(point) },
      onMove: track,
      onDrop: (point) => {
        const target = landingAt(point, held)
        settle()
        if (target === 'archive') setCloseRequest(session)
        else if (target !== undefined) void changeParent(held.id, target)
      },
      onCancel: settle,
    })
  }

  // the way OUT of a subtree is offered only while a nested row is in hand, and it is the list itself
  // rather than an element of its own — an affordance that costs no layout can be shown without moving
  // anything the reader is aiming at.
  const rootArmed = !!drag?.parent
  return (
    <div className="dock-session-body">
      <div className={`dock-session-list${rootArmed ? ' root-armed' : ''}${drag?.target === null ? ' root-on' : ''}`}
        {...(rootArmed ? { 'data-session-root-drop': '' } : {})}>
        {rows.length ? rows.map((item) => {
          if (item.type === 'zone') {
            const foldable = item.zone === 'offline'
            const label = t(`sessionZone.${item.zone}`)
            return <button key={`zone-${item.zone}`} type="button" className={`dock-session-zone dock-session-zone-${item.zone}`}
              aria-expanded={foldable ? !item.folded : undefined} onClick={foldable ? () => setOfflineOpen((open) => !open) : undefined}>
              <span>{label}</span><span className="dock-session-count">{item.count}{offline && <em className="dock-stale">{t('backend.stale')}</em>}</span>
            </button>
          }
          // This row is the one place a session is claimed. Plain click reads it IN THE CURRENT SLOT — a
          // session is a document like any other, and tmux holds the terminal state, so nothing is lost
          // when the slot moves on. Ctrl/⌘ or a double-click holds it as its own tab, and ⌥ scopes the
          // graph to its worktree — the gesture the retired map-side glance used to own.
          const locked = !!item.s.source && item.s.source === lockedSource
          return <SessionConsoleTreeRow key={item.s.id} item={item} activeId={activeId}
            dragging={drag?.id === item.s.id}
            dropTarget={drag?.target === item.s.id}
            onToggleFold={() => toggle(item.s.id)}
            rowProps={{
              'data-sid': item.s.id,
              'data-locked': locked ? '' : undefined,
              'data-tip': t('dockSessions.rowTip'),
              'aria-grabbed': drag?.id === item.s.id || undefined,
              onMouseDown: (event) => startRowDrag(event, item.s),
              onClick: (event) => {
                if (event.altKey) { event.preventDefault(); lockGraphTo(item.s.source); return }
                ;(event.ctrlKey || event.metaKey ? pinTab : navigate)('sessions', item.s.id)
              },
              onDoubleClick: () => pinTab('sessions', item.s.id),
              onContextMenu: (event) => {
                event.preventDefault()
                setMenu({ x: event.clientX, y: event.clientY, session: item.s })
              },
            }} />
        }) : <div className="dock-empty">—</div>}
      </div>
      {/* what the gap MEANS, said only while it means something. It floats over the list's foot and takes
          no pointer, so `elementFromPoint` still answers "the list" underneath it and no row moves. */}
      {rootArmed && <div className="dock-root-hint" aria-hidden="true">{t('session.rootDrop')}</div>}
      <SessionContextMenu
        menu={menu}
        closeRequest={closeRequest}
        onCloseRequestDone={() => setCloseRequest(null)}
        onClose={() => setMenu(null)}
        onChanged={reload}
        onError={(message) => notify(message, { kind: 'error' })}
        onLock={(s) => lockGraphTo(s.source, { toggle: false })}
      />
    </div>
  )
}

// The dock's one band. Left: what this projection is looking at, named in sentence case and tallied. Right:
// the doors that projection owns — icon-only, because the row is already saying which projection it is.
//
// SEARCH IS ONE OF THOSE DOORS, and that is why it left the rail ([[side-nav]]). A rail search button had to
// name a scope it could not know — it sat above both projections and opened one of them, so the reader
// asking "search what?" got the answer "whichever the button's author picked". Here the question is already
// answered by the row the button sits in: the sessions head searches sessions, the explorer head searches
// nodes. Same palette, same keys, same rows — only the lead plane differs ([[node-graph]]'s palette).
function DockHead({ mode, specs, sessions }) {
  const t = useT()
  const { offline } = useBackendHealth()
  const { openPalette } = useWorkspaceApi()
  const sessionMode = mode === 'sessions'
  const count = sessionMode ? (sessions?.length || 0) : (specs?.length || 0)
  const searchLabel = t(sessionMode ? 'dockModes.searchSessions' : 'dockModes.searchNodes')
  return (
    <div className="dock-head">
      <span className="dock-head-name">{t(sessionMode ? 'dockModes.sessions' : 'dockModes.explorer')}</span>
      <span className="dock-head-count">{count}{offline && <em className="dock-stale">{t('backend.stale')}</em>}</span>
      {/* The header owns projection doors only; open/closed belongs to the dedicated rail panel switch. */}
      <span className="dock-head-acts">
        <button type="button" className="dock-head-act" data-tip={withShortcut(searchLabel, 'graph.search')}
          aria-label={searchLabel} onClick={() => openPalette(sessionMode ? 'sessions' : 'nodes')}>
          <Icon name="search" size={13} />
        </button>
        {sessionMode && (
          <>
            {/* THE ARCHIVE DOOR IS ALSO A DROP DOOR. It opens the archive when clicked and takes a session
                when one is dropped on it — one door, one meaning ("where filed sessions go"), reached two
                ways. A separate drop strip would be a second answer to a question this button answers. */}
            <button type="button" className="dock-head-act dock-archive-door" data-session-archive-drop
              data-tip={t('dockSessions.archive')} aria-label={t('dockSessions.archive')}
              onClick={() => navigate('sessions', null, { query: { archive: '1' } })}>
              <Icon name="archive" size={13} />
            </button>
            <button type="button" className="dock-head-act dock-head-act-new" data-tip={t('dockSessions.new')} aria-label={t('dockSessions.new')}
              onClick={() => navigate('sessions', 'new')}>
              <Icon name="plus" size={14} />
            </button>
          </>
        )}
      </span>
    </div>
  )
}

export default function Dock({ mode, specs, sessions, focusId, activeSessionId, closing = false }) {
  // 200px is the resting width: wide enough for a session headline or a file name to read before it
  // ellipses, narrow enough that the finding dock stays a margin beside the document rather than a second
  // column competing with it. A reader who wants more drags it, and that choice is what persists — the
  // default only decides what an unopinionated window looks like.
  const [width, onDrag, reset] = useResizable('spex.ftWidth', 200, { min: 160, max: 460 })
  return (
    <aside className={closing ? 'dock dock-closing' : 'dock'} style={{ width }} aria-hidden={closing ? 'true' : undefined}>
      <DockHead mode={mode} specs={specs} sessions={sessions} />
      {mode === 'sessions'
        ? <SessionDock sessions={sessions} activeId={activeSessionId} />
        : <FileTree specs={specs} focusId={focusId} embedded />}
      <div className="ft-resize" onMouseDown={onDrag} onDoubleClick={reset} role="separator" aria-orientation="vertical" />
    </aside>
  )
}
