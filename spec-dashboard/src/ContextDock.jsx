import { useState } from 'react'
import { nodeEvalQuery, nodeIssueQuery } from '@spexcode/spec-core/review'
import { useBoard } from './workspace.jsx'
import { useReviewPage } from './reviewPage.js'
import { scenarioStates } from './score.jsx'
import { addressHash, evalAddress, issueAddress } from './address.js'
import { holdAnchor } from './tabs.js'
import { useResizable } from './useResizable.js'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { ReviewState } from './ReviewShell.jsx'

const PANEL_KEY = 'spexcode.ctxPanels'

function readPanels() {
  try {
    const value = JSON.parse(localStorage.getItem(PANEL_KEY) || 'null')
    return { scenarios: value?.scenarios !== false, issues: value?.issues !== false }
  } catch { return { scenarios: true, issues: true } }
}

// EVERY ROW IS A DETAIL DOOR, on the workspace's own slot semantics: a real anchor, plain click into the
// current slot, ctrl/⌘ into a tab of its own ([[tab-strip]]). The panels list objects that HAVE detail
// pages, so there is nothing here that opens a second-level panel inside the dock.
function Row({ href, children }) {
  return <a className="ctx-row" href={href} onClick={(event) => holdAnchor(event, href)}>{children}</a>
}

function Scenarios({ id }) {
  const t = useT()
  const page = useReviewPage('evals', nodeEvalQuery(id), 1, { pollMs: 0, view: 'timeline' })
  if (page.loading) return <div className="ctx-empty">{t('contextDock.loading')}</div>
  if (page.error) return <div className="ctx-empty ctx-error">{page.error}</div>
  const items = page.data?.items || []
  const declarations = [...new Map(items.filter((item) => item?.scenario).map((item) => [item.scenario, { name: item.scenario }])).values()]
  const readings = items.filter((item) => item.filterKind === 'result')
  const states = scenarioStates(declarations, readings)
  return states.length
    ? <div className="ctx-list">{states.map((state) => <Row key={state.name} href={addressHash(evalAddress(id, state.name))}>
      <span className={`ctx-score ${state.state}`} aria-label={t(`contextDock.states.${state.state}`)}>{state.state === 'pass' || state.state === 'stalePass' ? '✓' : state.state === 'fail' || state.state === 'staleFail' ? '×' : '○'}</span>
      <span className="ctx-row-label">{state.name}</span><span className="ctx-state">{t(`contextDock.states.${state.state}`)}</span>
    </Row>)}</div>
    : <div className="ctx-empty">{t('contextDock.noScenarios')}</div>
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

function Panel({ title, open, onToggle, children }) {
  return <section className="ctx-panel">
    <button type="button" className="ctx-panel-head" aria-expanded={open} onClick={onToggle}>
      <span>{title}</span><Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
    </button>
    {open && children}
  </section>
}

// [[context-dock]]: what surrounds the node the reader has open. Two sections and no third — the reader's
// own ruling: *"它要么就是 Scenarios，要么就是 Issues"*.
export default function ContextDock({ page, param, open = true, onToggle }) {
  const t = useT()
  const { specs } = useBoard()
  const [width, onDrag, reset] = useResizable('spex.ctxWidth', 276, { min: 220, max: 460, dir: -1 })
  const [panels, setPanels] = useState(readPanels)
  if (page !== 'spec' || !param || !open) return null
  const node = specs?.find((item) => item.id === param)
  if (!node) return null
  const togglePanel = (key) => setPanels((prev) => {
    const next = { ...prev, [key]: !prev[key] }
    try { localStorage.setItem(PANEL_KEY, JSON.stringify(next)) } catch {}
    return next
  })
  return <aside className="context-dock" style={{ width }} aria-label={t('contextDock.title')}>
    <div className="ctx-resize" onMouseDown={onDrag} onDoubleClick={reset} role="separator" aria-orientation="vertical" />
    <div className="ctx-head"><span>{t('contextDock.title')}</span><span className="ctx-node-id">{node.id}</span></div>
    <Panel title={t('contextDock.scenarios')} open={panels.scenarios} onToggle={() => togglePanel('scenarios')}>
      <Scenarios id={param} />
    </Panel>
    <Panel title={t('contextDock.issues')} open={panels.issues} onToggle={() => togglePanel('issues')}>
      <Issues id={param} />
    </Panel>
  </aside>
}
