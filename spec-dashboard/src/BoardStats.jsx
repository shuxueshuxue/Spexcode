import { useMemo } from 'react'
import { useT } from './i18n/index.jsx'
import { STATUS } from './SpecNode.jsx'
import { nodeScore } from './score.jsx'

// @@@ BoardStats - the per-node badges, TOTALLED. A glanceable strip pinned to the graph's bottom-left
// that sums, across the WHOLE spec tree, exactly the glyphs each node tile already wears — so it adds no
// new visual vocabulary (the legend already decodes all of it) and needs no backend (every number is
// folded here from the same /api/board payload the graph polls). Three clusters answer three questions:
//   · composition — the four status dots, counted: what the tree IS (and how settled).
//   · attention   — ⚠ drift commits + ◆ open issues, summed: what NEEDS a human.
//   · coverage    — the yatsu score circles, counted: how well-MEASURED the tree is.
// Each item is a JUMP, not just a number: clicking it focuses the FIRST node it counts (onJump → App's
// setFocusId, which drills that node's spine open and pans the camera to it). A zero-count item dims and
// goes inert — there is nowhere to jump.

const STATUS_ORDER = ['merged', 'active', 'drift', 'pending']

// one pass over the full node list → the cluster counts PLUS the first node id in each bucket (board
// order), which is the jump target a clicked stat lands on. `??=` keeps the first match only.
function summarize(specs) {
  const status = { merged: 0, active: 0, drift: 0, pending: 0 }
  const statusFirst = {}
  let driftAhead = 0, driftFirst = null
  let openIssues = 0, issueFirst = null
  const score = { pass: 0, fail: 0, stale: 0, blind: 0 }
  const scoreFirst = {}
  for (const n of specs) {
    if (status[n.status] != null) { status[n.status]++; statusFirst[n.status] ??= n.id }
    if (n.drift > 0) { driftAhead += n.drift; driftFirst ??= n.id }     // sum = the literal ⚠N badges, summed
    const oi = n.openIssues?.length || 0
    if (oi) { openIssues += oi; issueFirst ??= n.id }                   // sum = the ◆N badges, summed
    const s = nodeScore(n.evals)                                        // null when the node declares no scenarios
    const bucket = s === 'pass' ? 'pass'
      : s === 'fail' ? 'fail'
      : (s === 'stalePass' || s === 'staleFail') ? 'stale'
      : s === 'empty' ? 'blind'                                         // declares scenarios but has no current verdict
      : null
    if (bucket) { score[bucket]++; scoreFirst[bucket] ??= n.id }
  }
  return { total: specs.length, status, statusFirst, driftAhead, driftFirst, openIssues, issueFirst, score, scoreFirst }
}

// one stat chip: a glyph (passed as children) + its count. Clickable → jump to `first`, unless the count
// is zero (then it dims and ignores clicks). Shared by every cluster so they read and behave alike.
function Stat({ count, first, onJump, title, cls = '', children }) {
  const live = count > 0 && first
  return (
    <button type="button" className={`bstat ${cls}`.trim()} disabled={!live} title={title}
      onClick={live ? () => onJump(first) : undefined}>
      {children}{count}
    </button>
  )
}

export default function BoardStats({ specs, onJump }) {
  const t = useT()
  const s = useMemo(() => summarize(specs), [specs])
  const jump = (id) => onJump?.(id)
  return (
    <div className="board-stats" role="group" aria-label={t('stats.aria')}>
      {/* composition — the four status dots, counted. The leading number is the whole tree's size. */}
      <span className="bstat-total" title={t('stats.totalTitle', { n: s.total })}>{s.total}</span>
      {STATUS_ORDER.map((k) => (
        <Stat key={k} count={s.status[k]} first={s.statusFirst[k]} onJump={jump}
          title={t('stats.statusTitle', { n: s.status[k], status: t(`status.${k}`) })}>
          <span className="bstat-dot" style={{ background: STATUS[k].color }} />
        </Stat>
      ))}

      <span className="bstat-sep" />

      {/* attention — the ⚠ drift + ◆ open-issue badges, summed (same yellow / magenta the tiles use). */}
      <Stat count={s.driftAhead} first={s.driftFirst} onJump={jump} cls="bstat-drift"
        title={t('stats.driftTitle', { n: s.driftAhead })}>⚠</Stat>
      <Stat count={s.openIssues} first={s.issueFirst} onJump={jump} cls="bstat-issue"
        title={t('stats.issueTitle', { n: s.openIssues })}>◆</Stat>

      <span className="bstat-sep" />

      {/* coverage — the yatsu score circles, counted. Same ringed badge as the tiles (one vocabulary): a
          single ⊘ folds both stale verdicts; the empty ring (blind) shows only when there is one. */}
      <Stat count={s.score.pass} first={s.scoreFirst.pass} onJump={jump} title={t('stats.passTitle', { n: s.score.pass })}>
        <span className="score-badge pass">✓</span>
      </Stat>
      <Stat count={s.score.fail} first={s.scoreFirst.fail} onJump={jump} title={t('stats.failTitle', { n: s.score.fail })}>
        <span className="score-badge fail">✗</span>
      </Stat>
      <Stat count={s.score.stale} first={s.scoreFirst.stale} onJump={jump} title={t('stats.staleTitle', { n: s.score.stale })}>
        <span className="score-badge staleFail">⊘</span>
      </Stat>
      {s.score.blind > 0 && (
        <Stat count={s.score.blind} first={s.scoreFirst.blind} onJump={jump} title={t('stats.blindTitle', { n: s.score.blind })}>
          <span className="score-badge empty" />
        </Stat>
      )}
    </div>
  )
}
