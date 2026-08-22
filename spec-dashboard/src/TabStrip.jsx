import { useT } from './i18n/index.jsx'
import { Icon, IconButton } from './icons.jsx'
import { requestTab, tabKey, useTabs } from './tabs.js'
import { useWorkspaceApi } from './workspace.jsx'
import { STATUS } from './specMeta.js'
import { STATUS_COLOR } from './session.js'
import { getSessionBaseSurface, isSessionSurface, isResourceSurface, resourceSurfaceKey, resourceTabKey, SESSION_SURFACE_CONVERSATION } from './sessionSurface.js'
import { useDocumentActions } from './documentActions.jsx'

const resourceLabel = (url) => {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname.replace(/^\[|\]$/g, '')}:${parsed.port}${parsed.pathname === '/' ? '' : parsed.pathname}`
  } catch { return url }
}

// [[tab-strip]]'s face. It draws what [[tabs]] holds and owns no navigation of its own — every click is an
// ordinary `navigate`, so a tab and a link are the same action reaching the same address.

// A tab's label comes from the SAME projections the rest of the board reads, never from a second lookup
// table that could disagree: a node's own title, a session's own headline. When neither resolves (a node
// that has since been deleted, a session closed in another tab) the raw selector shows rather than a blank
// chip — an address that names nothing is still an address the reader typed.
function label(tab, { specs, sessions, t }) {
  if (tab.page === 'graph') return t('tabs.graph')
  // a document names itself: a node by its own title, a file by its basename. The strip does not invent a
  // naming scheme for documents it does not own.
  if (tab.page === 'spec') return specs?.find((s) => s.id === tab.param)?.title || tab.param
  if (tab.page === 'file') return tab.param?.split('/').pop() || t('tabs.graph')
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
  if (tab.page === 'spec' && tab.param) {
    const node = specs?.find((s) => s.id === tab.param)
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
  return ctx.t(`place.${page}`)
}

export default function TabStrip({ specs, sessions, route, trailing = null }) {
  const t = useT()
  const { tabs, activeKey, open, close, closeOthers } = useTabs()
  const { splitTo } = useWorkspaceApi()
  const actions = useDocumentActions()
  const activeActions = [...actions.values()]
    .filter((action) => action.document === activeKey)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id))
  return (
    <div className="tabstrip" role="tablist" aria-label={t('tabs.aria')}>
      {!tabs.length && <span className="tab-place">{placeLabel(route, { specs, sessions, t })}</span>}
      {tabs.map((tab) => {
        const key = tabKey(tab)
        const active = key === activeKey
        return (
          <div key={key} className={`tab${active ? ' on' : ''}${tab.preview ? ' preview' : ''}`} role="tab" aria-selected={active}
            onDoubleClick={(e) => {
              if (tab.preview && !e.target.closest('.tab-x')) requestTab(tab.page, tab.param, tab.query)
            }}
            onContextMenu={(e) => { e.preventDefault(); closeOthers(tab) }}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); close(tab) } }}>
            {/* alt-click sends a tab to the second pane: the reader is already pointing at the document
                they mean, so the gesture asks for no new vocabulary and no new surface. */}
            <button type="button" className="tab-face" data-tip={key}
              onClick={(e) => (e.altKey ? splitTo(tab) : open(tab))}>
              <TabDot tab={tab} specs={specs} sessions={sessions} />
              <span className="tab-label">{label(tab, { specs, sessions, t })}</span>
            </button>
            <button type="button" className="tab-x" onClick={() => close(tab)} aria-label={t('tabs.close')}>
              <Icon name="x" size={11} />
            </button>
          </div>
        )
      })}
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
