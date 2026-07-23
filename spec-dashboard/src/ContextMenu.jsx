import { useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import { inertChromePress } from './focus.js'

const VIEWPORT_GAP = 8

export function ContextMenu({ x, y, anchorKey, label, children }) {
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

export function ContextMenuItem({ icon, leading, danger = false, className = '', children, ...props }) {
  if (!icon && !leading) throw new Error('context menu item requires an icon or leading glyph')
  const classes = ['sess-menu-item', danger && 'danger', className].filter(Boolean).join(' ')
  return (
    <button type="button" role="menuitem" className={classes} {...props}>
      <span className="sess-menu-icon">{leading ?? <Icon name={icon} size={14} className="sess-menu-svg" />}</span>
      <span className="sess-menu-label">{children}</span>
    </button>
  )
}
