import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { tabKey, useTabs } from './tabs.js'
import { useWorkspaceApi } from './workspace.jsx'
import { STATUS } from './specMeta.js'
import { STATUS_COLOR } from './session.js'
import { getSessionBaseSurface, isSessionSurface, SESSION_SURFACE_CONVERSATION } from './sessionSurface.js'

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
    const surface = s?.capabilities?.headless === true || s?.liveness === 'offline' || s?.archived
      ? SESSION_SURFACE_CONVERSATION
      : (isSessionSurface(tab.query?.surface) ? tab.query.surface : getSessionBaseSurface(s?.id || tab.param))
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

export default function TabStrip({ specs, sessions }) {
  const t = useT()
  const { tabs, activeKey, open, close, closeOthers } = useTabs()
  const { splitTo } = useWorkspaceApi()
  // The strip shows even with one tab: it is where the current document's NAME lives, and chrome that
  // appears only when a second document exists jumps the layout at exactly the moment of the reader's
  // first hold.
  if (!tabs.length) return null
  return (
    <div className="tabstrip" role="tablist" aria-label={t('tabs.aria')}>
      {tabs.map((tab) => {
        const key = tabKey(tab)
        const active = key === activeKey
        return (
          <div key={key} className={`tab${active ? ' on' : ''}`} role="tab" aria-selected={active}
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
    </div>
  )
}
