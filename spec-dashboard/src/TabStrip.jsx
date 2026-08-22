import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { tabKey, useTabs } from './tabs.js'
import { STATUS } from './specMeta.js'

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
    return s?.label || s?.title || tab.param.slice(0, 8)
  }
  return t(`tabs.${tab.page}`)
}

// The dot repeats the board's own four-state vocabulary rather than inventing a tab-specific one, so a tab
// says the same thing about a node that its tile does.
function TabDot({ tab, specs }) {
  if (tab.page !== 'spec' || !tab.param) return null
  const node = specs?.find((s) => s.id === tab.param)
  if (!node || !STATUS[node.status]) return null
  return <i className="tab-dot" style={{ background: STATUS[node.status].color }} />
}

export default function TabStrip({ specs, sessions }) {
  const t = useT()
  const { tabs, activeKey, open, close, closeOthers } = useTabs()
  // One tab is not a strip — it is the same single-document frame the board has always been, so the chrome
  // stays out of the way until a second document actually exists.
  if (tabs.length < 2) return null
  return (
    <div className="tabstrip" role="tablist" aria-label={t('tabs.aria')}>
      {tabs.map((tab) => {
        const key = tabKey(tab)
        const active = key === activeKey
        return (
          <div key={key} className={`tab${active ? ' on' : ''}`} role="tab" aria-selected={active}
            onContextMenu={(e) => { e.preventDefault(); closeOthers(tab) }}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); close(tab) } }}>
            <button type="button" className="tab-face" onClick={() => open(tab)} data-tip={key}>
              <TabDot tab={tab} specs={specs} />
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
