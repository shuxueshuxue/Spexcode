import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { ReviewState } from './ReviewShell.jsx'

// the pass/fail MARK a reading scores, or null when there is no pass/fail to show — a legacy pre-verdict
// reading, or a legacy note-only one (status:'note', before `note` became an annotation on pass/fail). Those
// carry no ✓/✗, so they read as the empty ring. A modern note rides on a pass/fail, so it still scores.
function mark(r) {
  return r?.verdict?.status === 'pass' ? 'check' : r?.verdict?.status === 'fail' ? 'cross' : null
}

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

// `href` turns the count into a REAL anchor — the node's aggregate entry into the Evals LIST filtered to
// it (the caller mints the href through the one address helper, `evalAddress(nodeId)` with no scenario).
// Without `href` (the graph tile, whose click belongs to the board) it stays a passive glyph.
export function ScenarioCount({ scenarios, evals, href }) {
  const t = useT()
  const states = scenarioStates(scenarios, evals)
  if (!states.length) return null
  const state = aggregateState(states)
  const satisfied = states.filter((s) => s.state === 'pass').length
  const total = states.length
  const label = t('score.count', { satisfied, total, outstanding: total - satisfied })
  const body = <><Icon name="check" size={11} />{satisfied}/{total}</>
  if (!href) return <span className={`scenario-count ${state}`} data-tip={label} aria-label={label}>{body}</span>
  const linked = `${label} — ${t('score.openList')}`
  return <a className={`scenario-count ${state}`} href={href} data-tip={linked} aria-label={linked}>{body}</a>
}

// One compact state tally: the NodeView tab captions and the session toolbar share this exact
// ReviewState + number composition instead of growing parallel pass/fail/missing glyph mappings.
export function TabCount({ kind, state, cls, n, label }) {
  return (
    <span className={`ovc ${cls}`} data-tip={label}>
      <ReviewState kind={kind} state={state} title={label} size={11} />{n}
    </span>
  )
}

// the scenario's classification tags as a compact, wrapping row of chips — the ONE element used everywhere a
// scenario surfaces (search palette and eval tab), so a tag looks identical wherever it appears.
// Empty/absent → nothing rendered; the tag values are the configured library (lint.scenarioTags).
export function TagChips({ tags }) {
  if (!tags?.length) return null
  return (
    <span className="tag-chips">
      {tags.map((tag) => <span key={tag} className="tag-chip">{tag}</span>)}
    </span>
  )
}

// `title` overrides the default hover copy (the eval tab passes the moved-axis detail for a stale reading).
export function ScoreBadge({ state, title }) {
  if (!state) return null
  return <ReviewState kind="eval" state={state} title={title} className={`score-badge ${state}`} size={14} />
}
