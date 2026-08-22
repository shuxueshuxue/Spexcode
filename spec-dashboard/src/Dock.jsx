import { useMemo, useState } from 'react'
import FileTree from './FileTree.jsx'
import { SessionConsoleTreeRow, useFold } from './SessionWindow.jsx'
import { sessionForest } from './session.js'
import { navigate } from './route.js'
import { requestTab } from './tabs.js'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { useResizable } from './useResizable.js'
import { useWorkspace, useWorkspaceApi } from './workspace.jsx'

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
  const [offlineOpen, setOfflineOpen] = useState(false)
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
          // This row is the one place a session is claimed. Plain click reads it, ctrl/⌘ holds it as a tab,
          // and ⌥ scopes the graph to its worktree — the gesture the retired map-side glance used to own.
          const locked = !!item.s.source && item.s.source === lockedSource
          return <SessionConsoleTreeRow key={item.s.id} item={item} activeId={activeId} selecting={false} picked={new Set()}
            onToggleFold={() => toggle(item.s.id)}
            rowProps={{
              'data-sid': item.s.id,
              'data-locked': locked ? '' : undefined,
              'data-tip': t('dockSessions.rowTip'),
              onClick: (event) => {
                if (event.altKey) { event.preventDefault(); lockGraphTo(item.s.source); return }
                ;(event.ctrlKey || event.metaKey ? requestTab : navigate)('sessions', item.s.id)
              },
            }} />
        }) : <div className="dock-empty">—</div>}
      </div>
    </div>
  )
}

// The dock's one band. Left: what this projection is looking at, named in sentence case and tallied. Right:
// the doors that projection owns — icon-only, because the row is already saying which projection it is.
function DockHead({ mode, specs, sessions }) {
  const t = useT()
  const sessionMode = mode === 'sessions'
  const count = sessionMode ? (sessions?.length || 0) : (specs?.length || 0)
  return (
    <div className="dock-head">
      <span className="dock-head-name">{t(sessionMode ? 'dockModes.sessions' : 'dockModes.explorer')}</span>
      <span className="dock-head-count">{count}</span>
      {sessionMode && (
        <span className="dock-head-acts">
          <button type="button" className="dock-head-act" data-tip={t('dockSessions.archive')} aria-label={t('dockSessions.archive')}
            onClick={() => navigate('sessions', null, { query: { archive: '1' } })}>
            <Icon name="archive" size={13} />
          </button>
          <button type="button" className="dock-head-act" data-tip={t('dockSessions.new')} aria-label={t('dockSessions.new')}
            onClick={() => navigate('sessions', 'new')}>
            <Icon name="plus" size={14} />
          </button>
        </span>
      )}
    </div>
  )
}

export default function Dock({ mode, specs, sessions, focusId, activeSessionId }) {
  const [width, onDrag, reset] = useResizable('spex.ftWidth', 232, { min: 180, max: 460 })
  return (
    <aside className="dock" style={{ width }}>
      <DockHead mode={mode} specs={specs} sessions={sessions} />
      {mode === 'sessions'
        ? <SessionDock sessions={sessions} activeId={activeSessionId} />
        : <FileTree specs={specs} focusId={focusId} embedded />}
      <div className="ft-resize" onMouseDown={onDrag} onDoubleClick={reset} role="separator" aria-orientation="vertical" />
    </aside>
  )
}
