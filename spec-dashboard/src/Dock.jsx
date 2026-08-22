import { useMemo, useState } from 'react'
import FileTree from './FileTree.jsx'
import SessionContextMenu from './SessionContextMenu.jsx'
import { SessionConsoleTreeRow, useFold } from './SessionWindow.jsx'
import { sessionForest } from './session.js'
import { navigate } from './route.js'
import { pinTab } from './tabs.js'
import { useT } from './i18n/index.jsx'
import { withShortcut } from './bindings.js'
import { Icon } from './icons.jsx'
import { useResizable } from './useResizable.js'
import { useTransientNotice } from './TransientNotice.jsx'
import { useBoardApi, useWorkspace, useWorkspaceApi } from './workspace.jsx'

// [[dock-modes]]: one finding dock, two projections. Shell owns mode persistence; this component renders
// the selected projection and keeps every row on the existing route/tab contracts.
//
// THE DOCK IS ONE BAND. A projection may not mint chrome of its own: the name, the tally and the doors all
// live in the single header row below, so switching projection changes what the dock LISTS and never how
// thick the dock is. Explorer's count row, the sessions "+" and the archive door were three separate strips
// stacked around one list; that is three answers to a question the shell already answers once.
function SessionDock({ sessions, activeId }) {
  const t = useT()
  const { expanded, toggle } = useFold()
  const { lockedSource } = useWorkspace()
  const { lockGraphTo } = useWorkspaceApi()
  const { reload } = useBoardApi()
  const { notify } = useTransientNotice()
  const [offlineOpen, setOfflineOpen] = useState(false)
  // A session row's right-click menu belongs to the surface that LISTS sessions. It moved here with the
  // rows when the console's own list was retired, and for one release nothing brought it along: the rows
  // carried a click and nothing else, so rename/attach/lock/close had no pointer route left at all.
  const [menu, setMenu] = useState(null)
  const rows = useMemo(() => sessionForest(sessions || [], (id) => expanded.has(id), {
    zoneFolded: (zone) => zone === 'offline' && !offlineOpen,
    keepVisible: (session) => session.id === activeId,
  }), [sessions, expanded, offlineOpen, activeId])
  return (
    <div className="dock-session-body">
      <div className="dock-session-list">
        {rows.length ? rows.map((item) => {
          if (item.type === 'zone') {
            const foldable = item.zone === 'offline'
            const label = t(`sessionZone.${item.zone}`)
            return <button key={`zone-${item.zone}`} type="button" className={`dock-session-zone dock-session-zone-${item.zone}`}
              aria-expanded={foldable ? !item.folded : undefined} onClick={foldable ? () => setOfflineOpen((open) => !open) : undefined}>
              <span>{label}</span><span className="dock-session-count">{item.count}</span>
            </button>
          }
          // This row is the one place a session is claimed. Plain click reads it IN THE CURRENT SLOT — a
          // session is a document like any other, and tmux holds the terminal state, so nothing is lost
          // when the slot moves on. Ctrl/⌘ or a double-click holds it as its own tab, and ⌥ scopes the
          // graph to its worktree — the gesture the retired map-side glance used to own.
          const locked = !!item.s.source && item.s.source === lockedSource
          return <SessionConsoleTreeRow key={item.s.id} item={item} activeId={activeId} selecting={false} picked={new Set()}
            onToggleFold={() => toggle(item.s.id)}
            rowProps={{
              'data-sid': item.s.id,
              'data-locked': locked ? '' : undefined,
              'data-tip': t('dockSessions.rowTip'),
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
      <SessionContextMenu
        menu={menu}
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
  const { setDock, openPalette } = useWorkspaceApi()
  const sessionMode = mode === 'sessions'
  const count = sessionMode ? (sessions?.length || 0) : (specs?.length || 0)
  const searchLabel = t(sessionMode ? 'dockModes.searchSessions' : 'dockModes.searchNodes')
  return (
    <div className="dock-head">
      <span className="dock-head-name">{t(sessionMode ? 'dockModes.sessions' : 'dockModes.explorer')}</span>
      <span className="dock-head-count">{count}</span>
      {/* ONE doors cluster, whatever the projection: the projection's own doors, then collapse. A second
          cluster would be a second row's worth of answers in a header that exists to give one. */}
      <span className="dock-head-acts">
        <button type="button" className="dock-head-act" data-tip={withShortcut(searchLabel, 'graph.search')}
          aria-label={searchLabel} onClick={() => openPalette(sessionMode ? 'sessions' : 'nodes')}>
          <Icon name="search" size={13} />
        </button>
        {sessionMode && (
          <>
            <button type="button" className="dock-head-act" data-tip={t('dockSessions.archive')} aria-label={t('dockSessions.archive')}
              onClick={() => navigate('sessions', null, { query: { archive: '1' } })}>
              <Icon name="archive" size={13} />
            </button>
            <button type="button" className="dock-head-act" data-tip={t('dockSessions.new')} aria-label={t('dockSessions.new')}
              onClick={() => navigate('sessions', 'new')}>
              <Icon name="plus" size={14} />
            </button>
          </>
        )}
        {/* collapsing belongs on the thing being collapsed as well as on the rail button that opened it:
            the rail is where you ASK for a projection, and this is where you are done with it. One state,
            two doors — never two states. */}
        <button type="button" className="dock-head-act dock-collapse" data-tip={t('dockModes.collapse')}
          aria-label={t('dockModes.collapse')} onClick={() => setDock(false)}>
          <Icon name="panel-left" size={13} />
        </button>
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
