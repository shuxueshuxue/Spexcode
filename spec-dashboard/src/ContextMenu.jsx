import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import { inertChromePress } from './focus.js'

const VIEWPORT_GAP = 8

const commandsIn = (root) => [...(root?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])]

export function ContextMenu({ x, y, anchorKey, label, keyboard = false, children }) {
  const ref = useRef(null)
  const [position, setPosition] = useState({ left: x, top: y, visibility: 'hidden' })

  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    setPosition({
      left: Math.max(VIEWPORT_GAP, Math.min(x, window.innerWidth - rect.width - VIEWPORT_GAP)),
      top: Math.max(VIEWPORT_GAP, Math.min(y, window.innerHeight - rect.height - VIEWPORT_GAP)),
      visibility: 'visible',
    })
  }, [x, y, anchorKey])

  // A menu the KEYBOARD opened must be walkable by the keyboard, so it takes focus on its first command.
  // Pointer openings stay inert (below). One shell, two openings: the opening decides who owns focus,
  // which is why a right-click still leaves typing where it was while ⇧F10 lands you inside the menu.
  // It waits for the measured position to be PAINTED: the surface is `visibility: hidden` until it has been
  // clamped into the viewport, and focusing an invisible element is a silent no-op in every browser.
  useEffect(() => {
    if (keyboard && position.visibility === 'visible') commandsIn(ref.current)[0]?.focus()
  }, [keyboard, position.visibility, anchorKey])

  // Roving focus over the command rows. The menu OWNS ↑/↓/Home/End while it is open, so the walk cannot
  // leak to the surface underneath (the graph's j/k, a tree's own arrow nav) and move the very subject the
  // open menu is aimed at. Enter/Space stay native button activation; Esc stays with [[esc-layers]].
  const onKeyDown = useCallback((event) => {
    const rows = commandsIn(ref.current)
    if (!rows.length) return
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    const edge = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : null
    if (!step && edge === null) return
    event.preventDefault()
    event.stopPropagation()
    if (edge !== null) { rows[edge].focus(); return }
    const at = rows.indexOf(document.activeElement)
    rows[at === -1 ? (step > 0 ? 0 : rows.length - 1) : (at + step + rows.length) % rows.length].focus()
  }, [])

  // a menu is inert chrome ([[focus-return]]): picking an item acts but never moves focus, so
  // whichever input surface owned typing before the right-click still owns it after the pick.
  return (
    <div
      ref={ref}
      className="sess-menu"
      role="menu"
      aria-label={label}
      style={position}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      onMouseDownCapture={inertChromePress}
    >
      {children}
    </div>
  )
}

export function ContextMenuGroup({ children }) {
  return <div className="sess-menu-group" role="group">{children}</div>
}

export function ContextMenuSeparator() {
  return <div className="sess-menu-sep" role="separator" />
}

// `hint` prints the action's CURRENT binding, read from the registry by the caller ([[keyboard-nav]]'s hint
// reader) rather than typed into the label. A menu that names its own key teaches the keyboard instead of
// standing in for it, and a rebind moves the printed cap with the finger.
export function ContextMenuItem({ icon, leading, danger = false, hint = null, className = '', children, ...props }) {
  if (!icon && !leading) throw new Error('context menu item requires an icon or leading glyph')
  const classes = ['sess-menu-item', danger && 'danger', className].filter(Boolean).join(' ')
  return (
    <button type="button" role="menuitem" className={classes} {...props}>
      <span className="sess-menu-icon">{leading ?? <Icon name={icon} size={14} className="sess-menu-svg" />}</span>
      <span className="sess-menu-label">{children}</span>
      {hint ? <span className="sess-menu-hint" aria-hidden="true">{hint}</span> : null}
    </button>
  )
}
