import { useT } from './i18n/index.jsx'

// @@@ yatsu score vocabulary - ONE state, read two ways. A reading's circle: the ring is constant, COLOUR
// carries freshness and the centred MARK carries the verdict — green ✓ fresh pass · red ✗ fresh fail · GREY
// ✓/✗ stale (the last verdict greyed) · EMPTY ring no current score. The eval tab ([[yatsu-eval-tab]]) draws
// that circle per reading. The NODE TILE no longer shows a single fuzzy circle: it shows a per-scenario COUNT
// (ScenarioCount — ✓ satisfied / total), so a glance reads how many of a node's scenarios are satisfied and
// how many are still outstanding, not just one collapsed verdict. The count's COLOUR reuses this same
// worst-first vocabulary (aggregateState), so card and tab still speak one language.

// the pass/fail MARK a reading scores, or null when there is no pass/fail to show — a `note` (an observation,
// not a verdict) or a legacy pre-verdict reading. Those carry no ✓/✗, so they read as the empty ring.
function mark(r) {
  return r?.verdict?.status === 'pass' ? 'check' : r?.verdict?.status === 'fail' ? 'cross' : null
}

const GLYPH = { pass: '✓', fail: '✗', stalePass: '✓', staleFail: '✗', empty: '' }

// @@@ readingScore - ONE reading → a circle state. The glyph comes from the verdict, the colour from
// freshness; an unscorable verdict (note/legacy) shows the empty ring whatever its freshness.
export function readingScore(r) {
  const m = mark(r)
  if (!m) return 'empty'
  if (!r.fresh) return m === 'cross' ? 'staleFail' : 'stalePass'
  return m === 'cross' ? 'fail' : 'pass'
}

// @@@ scenarioStates - join a node's DECLARED scenarios (node.scenarios, folded by the board) to their latest
// reading (node.evals, newest-first) → one entry per scenario carrying its `state`: the circle state its
// latest reading scores, or 'missing' when no reading exists yet. A never-measured scenario is still a unit of
// loss, so it appears here (counts toward the total, reads as a blind spot) — the board ships the declared set
// precisely so the tile can see it, not just the readings that happen to exist. [] when the node has no yatsu.md.
export function scenarioStates(scenarios, evals) {
  if (!scenarios) return []
  const latest = new Map()                          // newest-first → first seen is the latest per scenario
  for (const r of evals || []) if (!latest.has(r.scenario)) latest.set(r.scenario, r)
  return scenarios.map((s) => {
    const reading = latest.get(s.name) || null
    return { ...s, reading, state: reading ? readingScore(reading) : 'missing' }
  })
}

// @@@ aggregateState - fold the per-scenario states to ONE worst-first state (drives the count's colour and
// any single-circle rollup), loudest signal first: any FRESH FAIL → red ✗; else any STALE (measured, now out
// of date) → grey (✗ if any stale scenario last-failed, else ✓); else any UNMEASURED/unscored scenario
// (never measured, or only a note/legacy reading) → the empty blind-spot ring; else every scenario is a FRESH
// PASS → green ✓. null when there are no scenarios (no badge at all).
export function aggregateState(states) {
  if (!states.length) return null
  if (states.some((s) => s.state === 'fail')) return 'fail'
  if (states.some((s) => s.state === 'staleFail')) return 'staleFail'
  if (states.some((s) => s.state === 'stalePass')) return 'stalePass'
  if (states.some((s) => s.state === 'empty' || s.state === 'missing')) return 'empty'
  return 'pass'                                     // every declared scenario fresh & passing
}

// @@@ nodeScore - the single worst-first state for a node, over its DECLARED scenarios joined to readings.
// Kept for the rollups that still want one circle/state (BoardStats coverage counts) — now scenario-aware, so
// a node with an unmeasured scenario reads as the blind spot it is, not a false pass. null = no yatsu.md.
export function nodeScore(scenarios, evals) {
  return aggregateState(scenarioStates(scenarios, evals))
}

// @@@ ScenarioCount - the per-scenario tally on the node tile (and the node-info stat bar): ✓ satisfied/total,
// coloured by the worst-first aggregate. This is the proposal's shift from one fuzzy node state to "how many
// of this node's scenarios are satisfied, how many still outstanding". `satisfied` = FRESH PASSES; the rest
// (fresh fail, stale, never-measured) are the outstanding loss — the gap total−satisfied makes legible at a
// glance. null (no badge) when the node declares no scenarios. Shares the score colour vocabulary above.
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

// @@@ ScoreBadge - the circle itself. `state` is one of pass | fail | stalePass | staleFail | empty (from
// nodeScore/readingScore), or a falsy value for no badge at all. `title` overrides the default hover copy —
// the eval tab passes the moved-axis detail for a stale reading.
export function ScoreBadge({ state, title }) {
  const t = useT()
  if (!state) return null
  const label = title ?? t(`score.${state}`)
  return <span className={`score-badge ${state}`} title={label} aria-label={label}>{GLYPH[state]}</span>
}
