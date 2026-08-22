import { useMemo, useState } from 'react'
import FileTree from './FileTree.jsx'
import { SessionConsoleTreeRow, useFold } from './SessionWindow.jsx'
import { sessionForest } from './session.js'
import { navigate } from './route.js'
import { requestTab } from './tabs.js'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { useResizable } from './useResizable.js'

// [[dock-modes]]: one finding dock, two projections. Shell owns mode persistence; this component renders
// the selected projection and keeps every row on the existing route/tab contracts.
function SessionDock({ sessions, activeId }) {
  const t = useT()
  const { expanded, toggle } = useFold()
  const [offlineOpen, setOfflineOpen] = useState(false)
  const rows = useMemo(() => sessionForest(sessions || [], (id) => expanded.has(id), {
    zoneFolded: (zone) => zone === 'offline' && !offlineOpen,
    keepVisible: (session) => session.id === activeId,
  }), [sessions, expanded, offlineOpen, activeId])
  return (
    <div className="dock-session-body">
      <div className="dock-session-head">
        <button type="button" className="dock-session-new" data-tip={t('dockSessions.new')} aria-label={t('dockSessions.new')}
          onClick={() => navigate('sessions', 'new')}>
          <Icon name="plus" size={14} />
        </button>
      </div>
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
          return <SessionConsoleTreeRow key={item.s.id} item={item} activeId={activeId} selecting={false} picked={new Set()}
            onToggleFold={() => toggle(item.s.id)}
            rowProps={{
              'data-sid': item.s.id,
              onClick: (event) => (event.ctrlKey || event.metaKey ? requestTab : navigate)('sessions', item.s.id),
            }} />
        }) : <div className="dock-empty">—</div>}
      </div>
      <button type="button" className="dock-session-archive" data-tip={t('dockSessions.archive')} aria-label={t('dockSessions.archive')}
        onClick={() => navigate('sessions', null, { query: { archive: '1' } })}>
        <Icon name="archive" size={13} /><span>{t('dockSessions.archive')}</span>
      </button>
    </div>
  )
}

export default function Dock({ mode, setMode, specs, sessions, focusId, activeSessionId }) {
  const t = useT()
  const [width, onDrag, reset] = useResizable('spex.ftWidth', 232, { min: 180, max: 460 })
  return (
    <aside className="dock" style={{ width }}>
      <div className="dock-modebar" role="tablist" aria-label={t('dockModes.aria')}>
        <button type="button" role="tab" aria-selected={mode === 'explorer'} className={`dock-mode${mode === 'explorer' ? ' on' : ''}`}
          data-tip={t('dockModes.explorer')} aria-label={t('dockModes.explorer')} onClick={() => setMode('explorer')}>
          <Icon name="explorer" size={15} />
        </button>
        <button type="button" role="tab" aria-selected={mode === 'sessions'} className={`dock-mode${mode === 'sessions' ? ' on' : ''}`}
          data-tip={t('dockModes.sessions')} aria-label={t('dockModes.sessions')} onClick={() => setMode('sessions')}>
          <Icon name="sessions" size={15} />
        </button>
        <span className="dock-mode-title">{t(mode === 'sessions' ? 'dockModes.sessions' : 'dockModes.explorer')}</span>
      </div>
      {mode === 'sessions'
        ? <SessionDock sessions={sessions} activeId={activeSessionId} />
        : <FileTree specs={specs} focusId={focusId} embedded />}
      <div className="ft-resize" onMouseDown={onDrag} onDoubleClick={reset} role="separator" aria-orientation="vertical" />
    </aside>
  )
}
