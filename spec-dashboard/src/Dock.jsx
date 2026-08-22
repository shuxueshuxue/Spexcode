import { useMemo } from 'react'
import FileTree from './FileTree.jsx'
import { SessionConsoleTreeRow } from './SessionWindow.jsx'
import { navigate } from './route.js'
import { requestTab } from './tabs.js'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { useResizable } from './useResizable.js'

// [[dock-modes]]: one finding dock, two projections. Shell owns mode persistence; this component renders
// the selected projection and keeps every row on the existing route/tab contracts.
function SessionDock({ sessions, activeId }) {
  const rows = useMemo(() => (sessions || []).map((s) => ({
    type: 'row', s, depth: 0, expandable: false, expanded: false, rollup: null, kin: 0, guides: [],
  })), [sessions])
  return (
    <div className="dock-session-body">
      {rows.length ? rows.map((item) => (
        <SessionConsoleTreeRow key={item.s.id} item={item} activeId={activeId} selecting={false} picked={new Set()}
          onToggleFold={() => {}}
          rowProps={{
            'data-sid': item.s.id,
            onClick: (event) => (event.ctrlKey || event.metaKey ? requestTab : navigate)('sessions', item.s.id),
          }} />
      )) : <div className="dock-empty">—</div>}
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
