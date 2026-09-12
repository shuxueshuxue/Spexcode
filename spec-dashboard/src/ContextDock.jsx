import { useState } from 'react'
import { nodeIssueQuery } from '@spexcode/spec-core/review'
import { useBoard } from './workspace.jsx'
import { useReviewPage } from './reviewPage.js'
import { addressHash, issueAddress } from './address.js'
import { newTabAnchor } from './tabs.js'
import { useResizable } from './useResizable.js'
import { useArrival, useFold } from './useFold.js'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { ReviewState } from './ReviewShell.jsx'
import { DiffStat } from './DiffMarks.jsx'
import { useHistory } from './specHistory.js'
import { routeHash } from './route.js'

const PANEL_KEY = 'spexcode.ctxPanels'

function readPanels() {
  try {
    const value = JSON.parse(localStorage.getItem(PANEL_KEY) || 'null')
    return { issues: value?.issues !== false, history: value?.history !== false }
  } catch { return { issues: true, history: true } }
}

// EVERY ROW IS A DETAIL DOOR, on the workspace's own tab semantics: a real anchor, plain click into the
// focused tab, ctrl/⌘ into a tab of its own ([[tab-strip]]). The panels list objects that HAVE detail
// pages, so there is nothing here that opens a second-level panel inside the dock.
function Row({ href, className = 'ctx-row', current = false, label, children }) {
  return <a className={className} href={href} aria-current={current ? 'page' : undefined} aria-label={label} data-tip={label}
    onClick={(event) => newTabAnchor(event, href)}>{children}</a>
}

// The node's OPEN issues, through the SAME paged review request the Issues board serves ([[paged-review]])
// with the node qualifier applied — never a second issue path with its own idea of what is open. A row is
// the issue's own detail address; the panel's head door is the same query as a full list, so "more" is
// literally this panel widened rather than a differently-filtered page.
function Issues({ id }) {
  const t = useT()
  const page = useReviewPage('issues', nodeIssueQuery(id), 1, { pollMs: 0 })
  if (page.loading) return <div className="ctx-empty">{t('contextDock.loadingIssues')}</div>
  if (page.error) return <div className="ctx-empty ctx-error">{page.error}</div>
  const items = page.data?.items || []
  return items.length
    ? <div className="ctx-list">{items.map((issue) => <Row key={issue.id} href={addressHash(issueAddress(issue.id))}>
      <ReviewState kind="issue" state={issue.status || 'open'} size={12} className="ctx-issue-state" />
      <span className="ctx-row-label">{issue.concern}</span>
    </Row>)}</div>
    : <div className="ctx-empty">{t('contextDock.noIssues')}</div>
}

// The node's versions, newest first, from the SAME log the popup's history pane reads. Each version has two
// doors into the document ([[spec-view]]): its text, and the change it made. The newest version's text IS the
// current document, so that door is the bare node address — the list is also the way back from the past.
// The row the document is showing is marked current; its change door is pressed while the change face shows.
function History({ node, query }) {
  const t = useT()
  const rows = useHistory(node.id, true, node.version)
  if (!rows) return <div className="ctx-empty">{t('contextDock.loadingHistory')}</div>
  if (rows.error) return <div className="ctx-empty ctx-error">{rows.error}</div>
  if (!rows.length) return <div className="ctx-empty">{t('contextDock.noHistory')}</div>
  const showing = query?.version || rows[0].hash
  const changeFace = query?.surface === 'diff'
  return <div className="ctx-list">{rows.map((row, i) => {
    const ordinal = rows.length - i
    const textHref = i === 0 ? routeHash('spec', node.id) : routeHash('spec', node.id, { version: row.hash })
    const changeHref = routeHash('spec', node.id, { version: row.hash, surface: 'diff' })
    const current = row.hash === showing && (!!query?.version || !changeFace)
    return <div key={row.hash} className={`ctx-version${current ? ' on' : ''}`}>
      <Row href={textHref} className="ctx-row ctx-version-text" current={current && !changeFace}
        label={t(i === 0 ? 'contextDock.versionCurrent' : 'contextDock.versionText', { n: ordinal })}>
        <span className="ctx-version-v">v{ordinal}</span>
        <span className="ctx-version-body">
          <span className="ctx-row-label">{row.reason}</span>
          <span className="ctx-version-meta">{(row.date || '').slice(0, 10)}<DiffStat additions={row.additions ?? 0} deletions={row.deletions ?? 0} /></span>
        </span>
      </Row>
      <Row href={changeHref} className="ctx-version-change" current={current && changeFace}
        label={t('contextDock.versionChange', { n: ordinal })}>
        <Icon name="git-compare" size={13} />
      </Row>
    </div>
  })}</div>
}

function Panel({ title, open, onToggle, children }) {
  return <section className="ctx-panel">
    <button type="button" className="ctx-panel-head" aria-expanded={open} onClick={onToggle}>
      <span>{title}</span><Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
    </button>
    {open && children}
  </section>
}

// [[context-dock]]: what surrounds the node the reader has open — what has been asked of it, and how it came
// to say what it says. The shell-owned right-edge switch stays mounted outside the animated panel.
export default function ContextDock({ page, param, query = null, open = true }) {
  const t = useT()
  const { specs } = useBoard()
  const [width, onDrag, reset] = useResizable('spex.ctxWidth', 276, { min: 220, max: 460, dir: -1 })
  const [panels, setPanels] = useState(readPanels)
  // the same fold every panel in the frame uses ([[dock-modes]]): the dock outlives `open` by one panel
  // duration so closing is a movement, not a blink. At rest it is still unmounted, which is what keeps a
  // closed dock costing nothing.
  const [mounted, closing, folding] = useFold(open)
  const arrival = useArrival(folding)
  if (page !== 'spec' || !param || !mounted) return null
  const node = specs?.find((item) => item.id === param)
  if (!node) return null
  const togglePanel = (key) => setPanels((prev) => {
    const next = { ...prev, [key]: !prev[key] }
    try { localStorage.setItem(PANEL_KEY, JSON.stringify(next)) } catch {}
    return next
  })
  // the same three-valued arrival the left band carries. This panel has no handover — one component always
  // draws it — so only the fold has a rule to match; publishing the attribute is what keeps it on the shared
  // mechanism rather than the one panel that silently pops open ([[dock-modes]]).
  return <aside className={closing ? 'context-dock dock-closing' : 'context-dock'} style={{ width }}
    data-fold={arrival || undefined}
    aria-hidden={closing ? 'true' : undefined} aria-label={t('contextDock.title')}>
    <div className="ctx-resize" onMouseDown={onDrag} onDoubleClick={reset} role="separator" aria-orientation="vertical" />
    <div className="ctx-head">
      <span>{t('contextDock.title')}</span>
      <span className="ctx-node-id">{node.id}</span>
    </div>
    {/* the two panels scroll TOGETHER inside the dock, and that scroller is what lets the dock clip its own
        width. Folding is a width movement, so the dock has to be `overflow: hidden` like the other two
        sidebars; without an inner scroller that clipping would make a long issue list unreachable instead
        of scrollable. The resize grip stays outside it so it cannot scroll away from its own edge. */}
    <div className="ctx-body">
      <Panel title={t('contextDock.issues')} open={panels.issues} onToggle={() => togglePanel('issues')}>
        <Issues id={param} />
      </Panel>
      <Panel title={t('contextDock.history')} open={panels.history} onToggle={() => togglePanel('history')}>
        <History node={node} query={query} />
      </Panel>
    </div>
  </aside>
}
