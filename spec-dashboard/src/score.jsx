import { useT } from './i18n/index.jsx'

// @@@ yatsu score vocabulary - ONE circle, read four ways. The ring is constant; COLOUR carries freshness and
// the centred MARK carries the verdict, so a glance separates "measured & current" from "measured but stale"
// from "never measured": green ✓ = fresh pass · red ✗ = fresh fail · GREY ✓/✗ = stale (the last verdict greyed
// — measured once, now out of date) · EMPTY ring = no current score (never measured, or only a note/legacy
// reading with no pass/fail to show). It is a RINGED circle with a centred glyph, deliberately UNLIKE the
// filled square status dot, so the score never reads as the node's git-derived state. Shared by the node tile
// ([[node-graph]], the at-a-glance card badge) and the eval tab ([[yatsu-eval-tab]], per reading) so the two
// surfaces speak ONE vocabulary.

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

// @@@ nodeScore - a node's whole eval timeline (node.evals, newest-first) → ONE circle for the tile, or null
// for NO badge (no yatsu.md → the `evals` field is absent → nothing to score). Aggregates over the LATEST
// reading per scenario, loudest signal first: any FRESH FAIL → red ✗; else any STALE (measured, now out of
// date) → grey (✗ if any stale scenario last-failed, else ✓); else any scenario with no current score (an
// empty timeline = declared-but-never-measured, or only a note/legacy reading) → the empty ring; else every
// scenario is a FRESH PASS → green ✓.
export function nodeScore(evals) {
  if (!evals) return null
  if (!evals.length) return 'empty'                 // declares scenarios, never measured
  const latest = new Map()                          // newest-first → first seen is the latest per scenario
  for (const r of evals) if (!latest.has(r.scenario)) latest.set(r.scenario, r)
  const reads = [...latest.values()]
  if (reads.some((r) => r.fresh && mark(r) === 'cross')) return 'fail'
  const stale = reads.filter((r) => !r.fresh && mark(r))
  if (stale.length) return stale.some((r) => mark(r) === 'cross') ? 'staleFail' : 'stalePass'
  if (reads.some((r) => !mark(r))) return 'empty'   // a scenario with no current pass/fail score = a blind spot
  return 'pass'                                     // every scenario fresh & passing
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
