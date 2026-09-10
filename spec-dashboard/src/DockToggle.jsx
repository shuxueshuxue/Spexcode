import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { useWorkspace, useWorkspaceApi } from './workspace.jsx'

// THE FOLD SWITCH MOVES WITH THE FOLD ([[side-nav]]). The sidebar open, it sits at the right end of that
// sidebar's own head row — the explorer head's last door, the Sessions forest's last pill — where an editor
// keeps the control that closes the panel you are looking at. The sidebar closed, there is no head row, so
// it stands as the first cell of the tab strip: the panel's edge is where the panel would reappear. One
// component, two mounts, one workspace boolean; it never navigates, never selects a projection, never lights.
//
// The glyph is `panel-left` in BOTH states: it names the dock this control owns, the same rule the right
// dock's switch follows with `panel-right`. A flipped glyph drew a panel on the wrong side to say "closed".
// State is `aria-pressed`, and the stylesheet reads it the way editors draw this switch: the owned pane is
// FILLED while the sidebar is open and HOLLOW while it is closed. One size (18px) at both mounts, so the
// glyph neither grows nor shrinks when the fold moves it from the head row to the strip.
export default function DockToggle({ variant = 'head', className = '' }) {
  const t = useT()
  const { dock } = useWorkspace()
  const { setDock } = useWorkspaceApi()
  if (!setDock) return null
  const label = t(dock ? 'dockModes.collapse' : 'dockModes.expand')
  return (
    <button type="button" className={`dock-toggle dock-toggle-${variant}${className ? ` ${className}` : ''}`}
      data-tip={label} aria-label={label} aria-pressed={dock} onClick={() => setDock((value) => !value)}>
      <Icon name="panel-left" size={18} />
    </button>
  )
}
