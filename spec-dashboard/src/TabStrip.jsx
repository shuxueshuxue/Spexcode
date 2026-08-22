import { useEffect, useRef, useState } from 'react'
import { useT } from './i18n/index.jsx'
import { Icon, IconButton } from './icons.jsx'
import { elementAt, startDrag } from './dragGesture.js'
import { moveTab, pinTab, tabKey, useTabs } from './tabs.js'
import { routeHash } from './route.js'
import { useWorkspaceApi } from './workspace.jsx'
import { STATUS } from './specMeta.js'
import { STATUS_COLOR } from './session.js'
import { getSessionBaseSurface, isSessionSurface, isResourceSurface, resourceSurfaceKey, resourceTabKey, SESSION_SURFACE_CONVERSATION } from './sessionSurface.js'
import { useDocumentActions, useDocumentNames } from './documentActions.jsx'

const resourceLabel = (url) => {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname.replace(/^\[|\]$/g, '')}:${parsed.port}${parsed.pathname === '/' ? '' : parsed.pathname}`
  } catch { return url }
}

// [[tab-strip]]'s face. It draws what [[tabs]] holds and owns no navigation of its own — every click is an
// ordinary `navigate`, so a tab and a link are the same action reaching the same address.

// A tab's label comes from the SAME projections the rest of the board reads, never from a second lookup
// table that could disagree: a node's own title, a session's own headline — or, where no projection holds
// the name at all, the document's own report of it ([[document-actions]]), which has one writer and so
// cannot disagree with anything. When nothing resolves (a node that has since been deleted, a session
// closed in another tab, an issue not yet loaded) the raw selector shows rather than a blank chip — an
// address that names nothing is still an address the reader typed.

// The eval detail's two halves, as the address carries them: `#/evals/<node>/<scenario>`.
export const evalDetailParts = (param) => {
  const i = String(param || '').indexOf('/')
  return i > 0 ? { node: param.slice(0, i), scenario: param.slice(i + 1) } : { node: param || '', scenario: '' }
}

// an issue id printed the way its own row prints it, for the tab that has not learned the title yet.
const issueNumber = (id) => {
  const parts = String(id || '').split('#')
  const value = parts.length > 1 ? parts.at(-1) : parts[0]
  return `#${value.length > 16 ? `${value.slice(0, 13)}…` : value}`
}

function label(tab, { specs, sessions, names, t }) {
  if (tab.page === 'graph') return t('tabs.graph')
  // a document names itself: a node by its own title, a file by its basename. The strip does not invent a
  // naming scheme for documents it does not own.
  if (tab.page === 'spec') return specs?.find((s) => s.id === tab.param)?.title || tab.param
  if (tab.page === 'file') return tab.param?.split('/').pop() || t('tabs.graph')
  // a DETAIL of a board is not the board: `#/evals` is the list and `#/evals/<node>/<scenario>` is one
  // reading, and while both said "Evals" the strip could hold three tabs nothing distinguished. The
  // scenario is the leaf and the node is the folder it sits in, so the tab reads container · leaf — the
  // same grammar a session tab uses, and both halves come from the address plus the resident node title.
  if (tab.page === 'evals' && tab.param) {
    const { node, scenario } = evalDetailParts(tab.param)
    const title = specs?.find((s) => s.id === node)?.title || node
    return scenario ? `${title} · ${scenario}` : title
  }
  if (tab.page === 'issues' && tab.param) {
    if (tab.param === 'new') return t('tabs.issueNew')
    // an issue has no resident projection to be named from ([[document-actions]]): the detail reports the
    // concern it already loaded, and until it has, the id is shown rather than a blank chip. The 220px tab
    // does the truncating, so the label stays the whole sentence and the ellipsis lands where it fits.
    return names?.get(routeHash('issues', tab.param)) || issueNumber(tab.param)
  }
  if (tab.page === 'sessions') {
    if (!tab.param || tab.param === 'new') return t('tabs.sessions')
    const s = sessions?.find((x) => x.id === tab.param || x.id?.startsWith(tab.param))
    const title = s?.label || s?.title || tab.param.slice(0, 8)
    const requestedSurface = isSessionSurface(tab.query?.surface) ? tab.query.surface : null
    if (isResourceSurface(requestedSurface)) {
      const key = resourceSurfaceKey(requestedSurface)
      const resource = [
        ...(s?.files || []).map((path) => ({ id: resourceTabKey(s.id, 'file', path), label: path.split('/').filter(Boolean).pop() || path })),
        ...(s?.web || []).map((web) => ({ id: resourceTabKey(s.id, 'web', web.key), label: resourceLabel(web.url) })),
      ].find((item) => item.id === key)
      return `${title} · ${resource?.label || key}`
    }
    const surface = s?.capabilities?.headless === true || s?.liveness === 'offline' || s?.archived
      ? SESSION_SURFACE_CONVERSATION
      : (requestedSurface || getSessionBaseSurface(s?.id || tab.param))
    return `${title} · ${t(`tabs.surface${surface[0].toUpperCase()}${surface.slice(1)}`)}`
  }
  return t(`tabs.${tab.page}`)
}

// The dot repeats the board's own four-state vocabulary rather than inventing a tab-specific one, so a tab
// says the same thing about a node that its tile does.
function TabDot({ tab, specs, sessions }) {
  // an eval detail wears the dot of the NODE it measures. Its own verdict is not on the board — it takes a
  // detail request to know — and a tab must never mint a fetch to draw itself; the node it belongs to is
  // resident, is what the reader navigated through to get here, and is the same dot that node's tile wears.
  const specId = tab.page === 'spec' ? tab.param : (tab.page === 'evals' && tab.param ? evalDetailParts(tab.param).node : null)
  if (specId) {
    const node = specs?.find((s) => s.id === specId)
    if (!node || !STATUS[node.status]) return null
    return <i className="tab-dot" style={{ background: STATUS[node.status].color }} />
  }
  if (tab.page === 'sessions' && tab.param && tab.param !== 'new') {
    const session = sessions?.find((s) => s.id === tab.param || s.id?.startsWith(tab.param))
    const color = session && STATUS_COLOR[session.status]
    return color ? <i className="tab-dot" style={{ background: color }} /> : null
  }
  return null
}

// WHERE AM I is the same question whether or not a document is open, so the strip answers it in both cases:
// tabs when there are tabs, the routed place's own name when there are none. Naming the place is also what
// earns the strip its unconditional row — the shell used to wrap it in a spacer div that rendered a blank
// 29px band on every non-document route, which is a band that says nothing.
export function placeLabel(route, ctx) {
  const { page, param } = route || {}
  if (page === 'spec' || page === 'file' || (page === 'sessions' && param)) return label(route, ctx)
  // a board DETAIL names its object here too, so the window title says which reading is open rather than
  // repeating the board's name at every one of its details.
  if ((page === 'evals' || page === 'issues') && param) return label(route, ctx)
  return ctx.t(`place.${page}`)
}

export default function TabStrip({ specs, sessions, route, trailing = null }) {
  const t = useT()
  const { tabs, activeKey, open, close, closeOthers, move } = useTabs()
  const names = useDocumentNames()
  const { splitTo } = useWorkspaceApi()
  const actions = useDocumentActions()
  // WHAT IS MOVING AND WHERE IT WOULD LAND — `{ key, before }`, with `before` naming the tab it would go in
  // FRONT of and null meaning the end of the strip ([[tab-strip]]'s splice). Nothing else about the strip
  // changes during a drag: the active document stays active, no address is written, and a release outside
  // any tab leaves the order exactly as it was.
  const [drag, setDrag] = useState(null)
  const abandon = useRef(null)
  useEffect(() => () => abandon.current?.(), [])

  // The insertion point under a pointer: the tab it is over, and which HALF of that tab. Past the midpoint
  // means after — which on the last tab is the end of the strip, the one landing place no tab can name. A
  // landing that would not move anything is reported as none, so the marker only ever appears where a
  // release genuinely changes the order.
  const landingAt = (point, movingKey) => {
    const el = elementAt(point.x, point.y, '.tab')
    if (!el) return undefined
    const index = tabs.findIndex((tab) => tabKey(tab) === el.dataset.tabKey)
    if (index < 0) return undefined
    const box = el.getBoundingClientRect()
    const after = point.x > box.left + box.width / 2
    const before = after ? (tabs[index + 1] ? tabKey(tabs[index + 1]) : null) : el.dataset.tabKey
    return moveTab(tabs, movingKey, before) === tabs ? undefined : before
  }

  const startTabDrag = (event, tab) => {
    const key = tabKey(tab)
    const track = (point) => {
      const before = landingAt(point, key)
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
      },
      onCancel: () => { setDrag(null); abandon.current = null },
    })
  }
  const activeActions = [...actions.values()]
    .filter((action) => action.document === activeKey)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id))
  // The band and the SCROLLER are two jobs, and they were one element. A strip that scrolls its tabs must
  // clip, and a clipping band cannot let an action's dropdown out — the resource picker rendered correctly
  // and was cut off at the strip's own 30px. Splitting them gives the tabs their scroller, leaves the band
  // itself unclipped so a menu can hang below it, and stops a long tab list from scrolling the action
  // cluster off the right edge.
  return (
    <div className="tabstrip">
      <div className="tabstrip-tabs" role="tablist" aria-label={t('tabs.aria')}>
      {!tabs.length && <span className="tab-place">{placeLabel(route, { specs, sessions, names, t })}</span>}
      {tabs.map((tab, index) => {
        const key = tabKey(tab)
        const active = key === activeKey
        // the insertion marker rides the tab the moved one would land in front of — or, for the end of the
        // strip, the trailing edge of the last tab. Two classes, one line, at home in any row of a wrapped
        // strip because it is drawn on a tab rather than between them.
        const marks = `${drag?.key === key ? ' tab-moving' : ''}${drag?.before === key ? ' tab-drop-before' : ''}`
          + `${drag && drag.before === null && index === tabs.length - 1 ? ' tab-drop-after' : ''}`
        return (
          <div key={key} data-tab-key={key} className={`tab${active ? ' on' : ''}${tab.pinned ? '' : ' slot'}${marks}`}
            role="tab" aria-selected={active} aria-grabbed={drag?.key === key || undefined}
            onMouseDown={(e) => startTabDrag(e, tab)}
            onDoubleClick={(e) => {
              if (!tab.pinned && !e.target.closest('.tab-x')) pinTab(tab.page, tab.param, tab.query)
            }}
            onContextMenu={(e) => { e.preventDefault(); closeOthers(tab) }}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); close(tab) } }}>
            {/* alt-click sends a tab to the second pane: the reader is already pointing at the document
                they mean, so the gesture asks for no new vocabulary and no new surface. */}
            <button type="button" className="tab-face" data-tip={key}
              onClick={(e) => (e.altKey ? splitTo(tab) : open(tab))}>
              <TabDot tab={tab} specs={specs} sessions={sessions} />
              <span className="tab-label">{label(tab, { specs, sessions, names, t })}</span>
            </button>
            <button type="button" className="tab-x" onClick={() => close(tab)} aria-label={t('tabs.close')}>
              <Icon name="x" size={11} />
            </button>
          </div>
        )
      })}
      </div>
      {(activeActions.length > 0 || trailing) && (
        <div className="tabstrip-actions" role="toolbar" aria-label={t('documentActions.aria')}>
          {activeActions.map((action) => {
            const label = action.disabled ? (action.disabledReason || action.label) : action.label
            return (
              <div key={action.key || `${action.document}:${action.id}`} className="document-action">
                <IconButton icon={action.icon} size={14} label={label}
                  className={`document-action-button${action.pressed ? ' on' : ''}${action.disabled ? ' disabled' : ''}`}
                  data-action={action.id}
                  aria-pressed={action.pressed}
                  aria-haspopup={action.haspopup ? 'menu' : undefined}
                  disabled={action.disabled}
                  onClick={action.onClick} />
                {action.menu}
              </div>
            )
          })}
          {trailing}
        </div>
      )}
    </div>
  )
}
