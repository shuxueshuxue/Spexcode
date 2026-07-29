import { useEffect } from 'react'
import { ContextMenu, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator } from './ContextMenu.jsx'
import { useEscLayer } from './escStack.js'
import { useT } from './i18n/index.jsx'
import { STATUS_COLOR, STATUS_GLYPH, sessionHeadline } from './session.js'

export default function NodeContextMenu({ menu, onClose, onInfo, onFresh, onNewChild, onDelete, sessions = [], onOpenSession }) {
  const t = useT()

  // standard context-menu dismissal (same as the session row menu): any click outside closes it; the menu
  // div stops its own clicks so picking an item never trips this. A right-click ANYWHERE also closes it —
  // bound in the CAPTURE phase, so it runs before a node's own contextmenu handler bubbles: right-clicking
  // another node closes the old menu first, then re-aims (React batches the two set-states into one paint);
  // right-clicking anything else just dismisses, and the browser's default menu takes over off-node.
  // Bound only while it's open.
  useEffect(() => {
    if (!menu) return
    window.addEventListener('click', onClose)
    window.addEventListener('contextmenu', onClose, true)
    return () => {
      window.removeEventListener('click', onClose)
      window.removeEventListener('contextmenu', onClose, true)
    }
  }, [menu, onClose])

  // Esc peels the menu through the shared [[esc-layers]] stack — one press closes it, never the board
  // surface behind it.
  useEscLayer(!!menu, onClose)

  if (!menu) return null
  // picking closes FIRST, then fires — the action may navigate away (New Session), and the menu must not
  // linger over the next page.
  const pick = (fn) => (e) => { e.stopPropagation(); onClose(); fn(menu.id) }
  const open = (id) => (e) => { e.stopPropagation(); onClose(); onOpenSession?.(id) }
  return (
    <ContextMenu x={menu.x} y={menu.y} anchorKey={menu.id} label={t('nodeMenu.menuLabel')}>
      <ContextMenuGroup>
        <ContextMenuItem icon="info" onClick={pick(onInfo)}>{t('nodeMenu.info')}</ContextMenuItem>
        <ContextMenuItem icon="sessions" onClick={pick(onFresh)}>{t('nodeMenu.newSession')}</ContextMenuItem>
        <ContextMenuItem icon="plus" onClick={pick(onNewChild)}>{t('nodeMenu.newChild')}</ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem icon="trash" danger onClick={pick(onDelete)}>{t('nodeMenu.del')}</ContextMenuItem>
      </ContextMenuGroup>
      {sessions.length > 0 && (
        <>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            {sessions.map((s) => (
              <ContextMenuItem
                key={s.id}
                className="sess-menu-sess"
                leading={<span className="sess-glyph" style={{ color: STATUS_COLOR[s.status] }} aria-hidden="true">{STATUS_GLYPH[s.status]}</span>}
                onClick={open(s.id)}
              >
                {sessionHeadline(s)}
              </ContextMenuItem>
            ))}
          </ContextMenuGroup>
        </>
      )}
    </ContextMenu>
  )
}
