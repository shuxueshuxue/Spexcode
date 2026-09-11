import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from './i18n/index.jsx'
import { Icon, IconButton } from './icons.jsx'
import { elementAt, startDrag } from './dragGesture.js'
import { moveTab, setTabTitle, tabKey, useTabs } from './tabs.js'
import { routeHash } from './route.js'
import { useWorkspaceApi } from './workspace.jsx'
import { STATUS } from './specMeta.js'
import { STATUS_COLOR, sessionHeadline } from './session.js'
import { isResourceSurface, resourceSurfaceKey } from './sessionSurface.js'
import { resourceCatalog } from './resourceCatalog.js'
import { useDocumentActions, useDocumentNames } from './documentActions.jsx'
import { pendingSessionFor } from './launch.js'
import { ContextMenu, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator } from './ContextMenu.jsx'
import { useEscLayer } from './escStack.js'
import { iconFor, isResident } from './viewCatalog.js'
import { PROJECT_ID, projectHref } from './project.js'

const tabWindowAddress = (tab) => {
  const hash = routeHash(tab.page, tab.param, tab.query)
  const scoped = PROJECT_ID ? projectHref(PROJECT_ID, hash) : hash
  return new URL(scoped, window.location.origin).href
}

const outsideViewport = ({ x, y }) => x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight

// [[tab-strip]]'s face. It draws what [[tabs]] holds and owns no navigation of its own — every click is an
// ordinary `navigate`, so a tab and a link are the same action reaching the same address.

// A tab's label comes from the SAME projections the rest of the board reads, never from a second lookup
// table that could disagree: a node's own title, a session's stable handle — or, where no projection holds
// the name at all, the document's own report of it ([[document-actions]]), which has one writer and so
// cannot disagree with anything. When nothing resolves (a node that has since been deleted, a session
// closed in another tab, an issue not yet loaded) the raw selector shows rather than a blank chip — an
// address that names nothing is still an address the reader typed.

function label(tab, { specs, sessions, t }) {
  if (tab.page === 'graph') return t('tabs.graph')
  // a document names itself: a node by its own title, a file by its basename. The strip does not invent a
  // naming scheme for documents it does not own.
  // Spec is one resident slot and keeps the Spec icon, but a selected node is the document being read.
  // The slot identity is canonicalized by tabModel; only its face changes to the board-owned title.
  if (tab.page === 'spec') return tab.param ? (specs?.find((s) => s.id === tab.param)?.title || tab.param) : t('tabs.spec')
  if (tab.page === 'file') return tab.param?.split('/').pop() || t('tabs.graph')
  // Review details are route state inside one dynamic top-level tab. The tab keeps the stable board name;
  // the URL still carries the selected issue for copy/back/refresh.
  if (tab.page === 'issues') return t('tabs.issues')
  if (tab.page === 'sessions') {
    if (!tab.param || tab.param === 'new') return t('tabs.sessions')
    const s = sessions?.find((x) => x.id === tab.param || x.id?.startsWith(tab.param)) || pendingSessionFor(tab.param)
    const title = s ? sessionHeadline(s) : (tab.title || tab.param.slice(0, 8))
    const requestedSurface = tab.query?.surface
    if (isResourceSurface(requestedSurface)) {
      const key = resourceSurfaceKey(requestedSurface)
      const resource = resourceCatalog(s).find((item) => item.id === key)
      return resource?.label || key
    }
    return title
  }
  return t(`tabs.${tab.page}`)
}

// The dot repeats the board's own four-state vocabulary rather than inventing a tab-specific one, so a tab
// says the same thing about a node that its tile does.
function TabDot({ tab, specs, sessions }) {
  const specId = tab.page === 'spec' ? tab.param : null
  if (specId) {
    const node = specs?.find((s) => s.id === specId)
    if (!node || !STATUS[node.status]) return null
    return <i className="tab-dot" style={{ background: STATUS[node.status].color }} />
  }
  if (tab.page === 'sessions' && tab.param && tab.param !== 'new') {
    const session = sessions?.find((s) => s.id === tab.param || s.id?.startsWith(tab.param)) || pendingSessionFor(tab.param)
    if (session?.status === 'starting' || session?.status === 'queued') return <i className="tab-spinner" aria-hidden="true">⟳</i>
    const color = session && STATUS_COLOR[session.status]
    return color ? <i className="tab-dot" style={{ background: color }} /> : null
  }
  return null
}

// Resident destinations keep one stable workspace identity while their URL selects a list or detail.
// Their icon therefore comes from the same view definition as the activity rail, instead of a second
// tab-only page map. Object documents keep their own status marker below.
function TabKindIcon({ tab }) {
  const icon = isResident(tab.page) ? iconFor(tab.page) : null
  return icon ? <Icon name={icon} size={13} className="tab-kind-icon" /> : null
}

// WHERE AM I is the same question whether or not a document is open, so the strip answers it in both cases:
// tabs when there are tabs, the routed place's own name when there are none. Naming the place is also what
// earns the strip its unconditional row — the shell used to wrap it in a spacer div that rendered a blank
// 29px band on every non-document route, which is a band that says nothing.
export function placeLabel(route, ctx) {
  const { page, param } = route || {}
  if (page === 'spec' || page === 'file' || (page === 'sessions' && param)) return label(route, ctx)
  // an issue DETAIL names its object here too, so the window title says which thread is open rather than
  // repeating the board's name at every one of its details.
  if (page === 'issues' && param) return label(route, ctx)
  return ctx.t(`place.${page}`)
}

export default function TabStrip({ specs, sessions, route, leading = null, trailing = null, onSessionContextMenu = null }) {
  const t = useT()
  const [closing, setClosing] = useState([])
  // ONE ROW, AND A LIST FOR WHAT THE ROW CANNOT SHOW. Tabs shrink toward their floor and then the row
  // clips; it never wraps onto a second row (a strip whose thickness was the working set moved the whole
  // document down every time a reader opened one more thing) and never scrolls sideways behind a gesture.
  // `clipped` is the mark that says some of the working set is out of sight — it lights the list button,
  // which is the ONE way back to every held tab, visible or not.
  const [clipped, setClipped] = useState(false)
  const [listMenu, setListMenu] = useState(null)
  const listButtonRef = useRef(null)
  const tabsHostRef = useRef(null)
  const startTabClose = useCallback((tab) => {
    const key = tabKey(tab)
    setClosing((current) => {
      if (current.some((entry) => entry.key === key)) return current
      const index = tabsRef.current.findIndex((item) => tabKey(item) === key)
      return [...current, { key, tab, index }]
    })
    const duration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 150
    window.setTimeout(() => setClosing((current) => current.filter((entry) => entry.key !== key)), duration)
  }, [])
  const tabsRef = useRef([])
  const { tabs, activeKey, open, close, closeOthers, move } = useTabs({ onCloseStart: startTabClose })
  tabsRef.current = tabs
  useEffect(() => {
    const host = tabsHostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return undefined
    const update = () => {
      const next = host.scrollWidth > host.clientWidth + 1
      setClipped((current) => (current === next ? current : next))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [tabs.length])
  // the active tab is never one of the clipped ones: a clipped row can still be moved programmatically,
  // so focusing a tab (from the list, a shortcut, a link) brings it into the visible stretch.
  useEffect(() => {
    const el = tabsHostRef.current?.querySelector('.tab.on')
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeKey, tabs.length])
  const names = useDocumentNames()
  const { splitTo } = useWorkspaceApi()
  const actions = useDocumentActions()
  useEffect(() => {
    for (const tab of tabs) {
      if (tab.page !== 'sessions' || !tab.param || tab.param === 'new') continue
      const session = sessions?.find((item) => item.id === tab.param || item.id?.startsWith(tab.param))
      const title = session ? sessionHeadline(session) : ''
      if (title) setTabTitle(tab, title)
    }
  }, [sessions, tabs])
  // WHAT IS MOVING AND WHERE IT WOULD LAND — `{ key, before }`, with `before` naming the tab it would go in
  // FRONT of and null meaning the end of the strip ([[tab-strip]]'s splice). Nothing else about the strip
  // changes during a drag: the active document stays active, no address is written, and a release outside
  // any tab leaves the order exactly as it was.
  const [drag, setDrag] = useState(null)
  const [menu, setMenu] = useState(null)
  const abandon = useRef(null)
  useEffect(() => () => abandon.current?.(), [])
  useEffect(() => {
    if (!menu && !listMenu) return undefined
    const dismiss = (event) => {
      if (event.target?.closest?.('.sess-menu')) return
      setMenu(null)
      setListMenu(null)
    }
    window.addEventListener('click', dismiss)
    window.addEventListener('contextmenu', dismiss, true)
    return () => {
      window.removeEventListener('click', dismiss)
      window.removeEventListener('contextmenu', dismiss, true)
    }
  }, [menu, listMenu])
  useEscLayer(!!menu || !!listMenu, () => { setMenu(null); setListMenu(null) })
  // the list hangs off the button's own corner, so it opens where the reader pressed rather than at a
  // pointer position that a keyboard activation does not have.
  const openList = (event) => {
    event.stopPropagation()
    const box = listButtonRef.current?.getBoundingClientRect()
    setListMenu((current) => (current ? null : { x: box ? box.right - 220 : event.clientX, y: box ? box.bottom + 4 : event.clientY }))
  }

  // The insertion point under a pointer: the tab it is over, and which HALF of that tab. Past the midpoint
  // means after — which on the last tab is the end of the strip, the one landing place no tab can name. The
  // host's unoccupied right edge is that same end landing, so the reader never has to hit the last tab.
  // A landing that would not move anything is reported as none, so the marker only ever appears where a
  // move genuinely changes the order.
  const landingAt = (point, movingKey) => {
    const currentTabs = tabsRef.current
    const el = elementAt(point.x, point.y, '.tab')
    if (el) {
      const index = currentTabs.findIndex((tab) => tabKey(tab) === el.dataset.tabKey)
      if (index < 0) return undefined
      const box = el.getBoundingClientRect()
      const after = point.x > box.left + box.width / 2
      const before = after ? (currentTabs[index + 1] ? tabKey(currentTabs[index + 1]) : null) : el.dataset.tabKey
      return moveTab(currentTabs, movingKey, before) === currentTabs ? undefined : before
    }

    const host = tabsHostRef.current
    if (!host || !currentTabs.length) return undefined
    const hostBox = host.getBoundingClientRect()
    if (point.x < hostBox.left || point.x > hostBox.right || point.y < hostBox.top || point.y > hostBox.bottom) return undefined
    const rightEdge = Math.max(...[...host.querySelectorAll('.tab')].map((tab) => tab.getBoundingClientRect().right))
    if (point.x < rightEdge) return undefined
    return moveTab(currentTabs, movingKey, null) === currentTabs ? undefined : null
  }

  const startTabDrag = (event, tab) => {
    const key = tabKey(tab)
    const track = (point) => {
      const before = landingAt(point, key)
      if (before !== undefined) move(key, before)
      setDrag((prev) => (prev && prev.key === key && prev.before === before ? prev : { key, before }))
    }
    abandon.current = startDrag(event, {
      onStart: track,
      onMove: track,
      onDrop: (point) => {
        const before = landingAt(point, key)
        setDrag(null)
        abandon.current = null
        if (before !== undefined) move(key, before)
        else if (outsideViewport(point)) {
          const detached = tabsRef.current.find((item) => tabKey(item) === key)
          if (detached) {
            window.open(tabWindowAddress(detached))
            close(detached)
          }
        }
      },
      onCancel: () => { setDrag(null); abandon.current = null },
    })
  }
  const activeAddress = routeHash(route.page, route.param, route.query)
  const activeActions = [...actions.values()]
    .filter((action) => action.document === activeAddress)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id))
  const renderedTabs = [...tabs]
  closing.filter((entry) => !tabs.some((tab) => tabKey(tab) === entry.key))
    .sort((a, b) => a.index - b.index)
    .forEach((entry) => renderedTabs.splice(Math.max(0, Math.min(entry.index, renderedTabs.length)), 0, entry.tab))
  // The band and the SCROLLER are two jobs, and they were one element. The tabs host clips its row so the
  // working set never grows the band; the band itself stays unclipped so a menu (an action's dropdown, the
  // tab list) can hang below it, and the action cluster keeps its own column that no tab can run under.
  return (
    <div className="tabstrip">
      {leading}
      <div ref={tabsHostRef} className="tabstrip-tabs" role="tablist" aria-label={t('tabs.aria')}>
      {!tabs.length && <span className="tab-place">{placeLabel(route, { specs, sessions, names, t })}</span>}
      {renderedTabs.map((tab, index) => {
        const key = tabKey(tab)
        const isClosing = closing.some((entry) => entry.key === key) && !tabs.some((item) => tabKey(item) === key)
        const active = key === activeKey
        const tabLabel = label(tab, { specs, sessions, names, t })
        // the insertion marker rides the tab the moved one would land in front of — or, for the end of the
        // strip, the trailing edge of the last tab. Two classes, one line, drawn on a tab rather than between
        // them so the row's own dividers never have to move.
        const marks = `${drag?.key === key ? ' tab-moving' : ''}${drag?.before === key ? ' tab-drop-before' : ''}`
          + `${drag && drag.before === null && index === tabs.length - 1 ? ' tab-drop-after' : ''}`
        return (
          <div key={key} data-tab-key={key} className={`tab${active ? ' on' : ''}${isClosing ? ' tab-closing' : ''}${marks}`}
            role="tab" aria-selected={active} aria-grabbed={drag?.key === key || undefined}
            aria-hidden={isClosing ? 'true' : undefined}
            onPointerDown={(e) => { if (!isClosing) startTabDrag(e, tab) }}
            onContextMenu={(e) => {
              if (isClosing) return
              e.preventDefault()
              const session = tab.page === 'sessions' && tab.param && tab.param !== 'new'
                ? (sessions?.find((item) => item.id === tab.param || item.id?.startsWith(tab.param)) || pendingSessionFor(tab.param))
                : null
              if (session && onSessionContextMenu) {
                setMenu(null)
                onSessionContextMenu({ x: e.clientX, y: e.clientY, session })
              } else setMenu({ x: e.clientX, y: e.clientY, tab, key })
            }}
            onAuxClick={(e) => { if (!isClosing && e.button === 1) { e.preventDefault(); close(tab) } }}>
            {/* alt-click sends a tab to the second pane: the reader is already pointing at the document
                they mean, so the gesture asks for no new vocabulary and no new surface. */}
            {/* the INNER band is what lights under the pointer — an inset rounded rect, the same shape a
                session row wears — while the tab's own box keeps the card outline, the dividers and the
                drop marks. */}
            <div className="tab-inner">
              <button type="button" className="tab-face" data-tip={tabLabel} aria-label={tabLabel}
                onClick={(e) => { if (!isClosing) (e.altKey ? splitTo(tab) : open(tab)) }}>
                <TabKindIcon tab={tab} />
                <TabDot tab={tab} specs={specs} sessions={sessions} />
                <span className="tab-label">{tabLabel}</span>
              </button>
              <button type="button" className="tab-x" onClick={() => { if (!isClosing) close(tab) }} aria-label={t('tabs.close')}>
                <Icon name="x" size={11} />
              </button>
            </div>
            {/* the active card's SHOULDERS: two 8px quarter-circles outside its lower corners, filled with the
                page's paper, so the card's sides curve outward into the band's baseline instead of meeting it
                at a right angle — the way an editor's live tab flows into its pane. */}
            {active && <><i className="tab-shoulder tab-shoulder-l" aria-hidden="true" /><i className="tab-shoulder tab-shoulder-r" aria-hidden="true" /></>}
          </div>
        )
      })}
      </div>
      {(tabs.length > 0 || activeActions.length > 0 || trailing) && (
        <div className="tabstrip-actions" role="toolbar" aria-label={t('documentActions.aria')}>
          {tabs.length > 0 && (
            <button ref={listButtonRef} type="button"
              className={`document-action-button tab-list-button${clipped ? ' clipped' : ''}${listMenu ? ' on' : ''}`}
              aria-label={t('tabs.list')} data-tip={t('tabs.list')} aria-haspopup="menu" aria-expanded={!!listMenu}
              onClick={openList}>
              <Icon name="chevron-down" size={14} />
            </button>
          )}
          {activeActions.map((action) => {
            const label = action.disabled ? (action.disabledReason || action.label) : action.label
            return (
              <div key={action.key || `${action.document}:${action.id}`} className="document-action">
                {action.node || <IconButton icon={action.icon} size={14} label={label}
                  className={`document-action-button${action.pressed ? ' on' : ''}${action.disabled ? ' disabled' : ''}`}
                  data-action={action.id}
                  aria-pressed={action.pressed}
                  aria-haspopup={action.haspopup ? 'menu' : undefined}
                  disabled={action.disabled}
                  onClick={action.onClick} />}
                {action.menu}
              </div>
            )
          })}
          {trailing}
        </div>
      )}
      {listMenu && (
        <ContextMenu x={listMenu.x} y={listMenu.y} anchorKey="tab-list" label={t('tabs.list')}>
          <ContextMenuGroup>
            {tabs.map((tab) => {
              const key = tabKey(tab)
              const active = key === activeKey
              // the row wears the same face the tab does — kind icon for a resident page, the document's own
              // status mark otherwise — so the list is the strip laid out downward, not a second vocabulary.
              return (
                <ContextMenuItem key={key} icon={isResident(tab.page) ? iconFor(tab.page) : 'files'}
                  className={active ? 'tab-list-current' : ''} aria-current={active ? 'true' : undefined}
                  onClick={(e) => { e.stopPropagation(); setListMenu(null); open(tab) }}>
                  {label(tab, { specs, sessions, names, t })}
                </ContextMenuItem>
              )
            })}
          </ContextMenuGroup>
        </ContextMenu>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} anchorKey={menu.key} label={t('tabs.menuLabel')}>
          <ContextMenuGroup>
            <ContextMenuItem icon="x" danger onClick={(e) => { e.stopPropagation(); setMenu(null); close(menu.tab) }}>
              {t('tabs.menuClose')}
            </ContextMenuItem>
            <ContextMenuItem icon="circle-minus" danger onClick={(e) => { e.stopPropagation(); setMenu(null); closeOthers(menu.tab) }}>
              {t('tabs.menuCloseOthers')}
            </ContextMenuItem>
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem icon="panel-right" onClick={(e) => { e.stopPropagation(); setMenu(null); splitTo(menu.tab) }}>
              {t('tabs.menuSplit')}
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenu>
      )}
    </div>
  )
}
