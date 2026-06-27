import { useT } from './i18n/index.jsx'

// the pass/fail MARK a reading scores, or null when there is no pass/fail to show — a `note` (an observation,
// not a verdict) or a legacy pre-verdict reading. Those carry no ✓/✗, so they read as the empty ring.
function mark(r) {
  return r?.verdict?.status === 'pass' ? 'check' : r?.verdict?.status === 'fail' ? 'cross' : null
}

const GLYPH = { pass: '✓', fail: '✗', stalePass: '✓', staleFail: '✗', empty: '' }

export function readingScore(r) {
  const m = mark(r)
  if (!m) return 'empty'
  if (!r.fresh) return m === 'cross' ? 'staleFail' : 'stalePass'
  return m === 'cross' ? 'fail' : 'pass'
}

export function scenarioStates(scenarios, evals) {
  if (!scenarios) return []
  const latest = new Map()                          // newest-first → first seen is the latest per scenario
  for (const r of evals || []) if (!latest.has(r.scenario)) latest.set(r.scenario, r)
  return scenarios.map((s) => {
    const reading = latest.get(s.name) || null
    return { ...s, reading, state: reading ? readingScore(reading) : 'missing' }
  })
}

export function aggregateState(states) {
  if (!states.length) return null
  if (states.some((s) => s.state === 'fail')) return 'fail'
  if (states.some((s) => s.state === 'staleFail')) return 'staleFail'
  if (states.some((s) => s.state === 'stalePass')) return 'stalePass'
  if (states.some((s) => s.state === 'empty' || s.state === 'missing')) return 'empty'
  return 'pass'                                     // every declared scenario fresh & passing
}

export function nodeScore(scenarios, evals) {
  return aggregateState(scenarioStates(scenarios, evals))
}

export function ScenarioCount({ scenarios, evals }) {
  const t = useT()
  const states = scenarioStates(scenarios, evals)
  if (!states.length) return null
  const state = aggregateState(states)
  const satisfied = states.filter((s) => s.state === 'pass').length
  const total = states.length
  const label = t('score.count', { satisfied, total, outstanding: total - satisfied })
  return <span className={`scenario-count ${state}`} title={label} aria-label={label}>✓{satisfied}/{total}</span>
}

// `title` overrides the default hover copy (the eval tab passes the moved-axis detail for a stale reading).
export function ScoreBadge({ state, title }) {
  const t = useT()
  if (!state) return null
  const label = title ?? t(`score.${state}`)
  return <span className={`score-badge ${state}`} title={label} aria-label={label}>{GLYPH[state]}</span>
}
