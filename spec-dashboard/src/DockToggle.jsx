import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { useWorkspace, useWorkspaceApi } from './workspace.jsx'

// THE FOLD SWITCH MOVES WITH THE FOLD ([[side-nav]]). The sidebar open, it sits at the right end of that
// sidebar's own head row — the explorer head's last door, the Sessions forest's last pill — where an editor
// keeps the control that closes the panel you are looking at. The sidebar closed, there is no head row, so
// it stands as the first cell of the tab strip: the panel's edge is where the panel would reappear. One
// component, two mounts, one workspace boolean; it never navigates, never selects a projection, never lights.
//
// The glyph always draws the LEFT panel's frame — it names the dock this control owns, the same rule the
// right dock's switch follows with the panel-right family; a glyph that flipped to the other side's panel to
// say "closed" pictured the wrong region. State is the chevron inside that frame: `panel-left-close` while
// the sidebar is open (fold it in), `panel-left-open` while it is closed (unfold it) — Lucide's own pair, at
// the 14px the head-row glyphs around it use, and one size at both mounts so the fold never resizes it.
export default function DockToggle({ variant = 'head', className = '' }) {
  const t = useT()
  const { dock } = useWorkspace()
  const { setDock } = useWorkspaceApi()
  if (!setDock) return null
  const label = t(dock ? 'dockModes.collapse' : 'dockModes.expand')
  return (
    <button type="button" className={`dock-toggle dock-toggle-${variant}${className ? ` ${className}` : ''}`}
      data-tip={label} aria-label={label} aria-pressed={dock} onClick={() => setDock((value) => !value)}>
      <Icon name={dock ? 'panel-left-close' : 'panel-left-open'} size={14} />
    </button>
  )
}
