import { useMemo, useState } from 'react'
import { nodeEvalQuery } from '@spexcode/spec-core/review'
import { useBoard } from './workspace.jsx'
import { useReviewPage } from './reviewPage.js'
import { scenarioStates } from './score.jsx'
import { addressHash, evalAddress } from './address.js'
import { routeHash } from './route.js'
import { useResizable } from './useResizable.js'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'

const PANEL_KEY = 'spexcode.ctxPanels'

function readPanels() {
  try {
    const value = JSON.parse(localStorage.getItem(PANEL_KEY) || 'null')
    return { backlinks: value?.backlinks !== false, scenarios: value?.scenarios !== false }
  } catch { return { backlinks: true, scenarios: true } }
}

function Backlinks({ specs, id }) {
  const t = useT()
  const rows = useMemo(() => (specs || []).filter((node) => {
    if (node.id === id) return false
    if (node.parent === id) return true
    return (node.related || []).some((edge) => {
      const value = String(edge).replace(/^\[\[|\]\]$/g, '').split('#')[0]
      return value === id
    })
  }), [specs, id])
  return rows.length
    ? <div className="ctx-list">{rows.map((node) => <a key={node.id} className="ctx-row" href={routeHash('spec', node.id)}>
      <span className="ctx-row-mark">↗</span><span className="ctx-row-label">{node.title || node.id}</span><code>{node.id}</code>
    </a>)}</div>
    : <div className="ctx-empty">{t('contextDock.noBacklinks')}</div>
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
    ? <div className="ctx-list">{states.map((state) => <a key={state.name} className="ctx-row" href={addressHash(evalAddress(id, state.name))}>
      <span className={`ctx-score ${state.state}`} aria-label={t(`contextDock.states.${state.state}`)}>{state.state === 'pass' || state.state === 'stalePass' ? '✓' : state.state === 'fail' || state.state === 'staleFail' ? '×' : '○'}</span>
      <span className="ctx-row-label">{state.name}</span><span className="ctx-state">{t(`contextDock.states.${state.state}`)}</span>
    </a>)}</div>
    : <div className="ctx-empty">{t('contextDock.noScenarios')}</div>
}

function Panel({ title, open, onToggle, children }) {
  return <section className="ctx-panel">
    <button type="button" className="ctx-panel-head" aria-expanded={open} onClick={onToggle}>
      <span>{title}</span><Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
    </button>
    {open && children}
  </section>
}

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
    <Panel title={t('contextDock.backlinks')} open={panels.backlinks} onToggle={() => togglePanel('backlinks')}><Backlinks specs={specs} id={param} /></Panel>
    <Panel title={t('contextDock.scenarios')} open={panels.scenarios} onToggle={() => togglePanel('scenarios')}><Scenarios id={param} /></Panel>
  </aside>
}
