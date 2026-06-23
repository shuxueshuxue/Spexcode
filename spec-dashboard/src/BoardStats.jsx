import { useMemo } from 'react'
import { useT } from './i18n/index.jsx'
import { STATUS } from './SpecNode.jsx'
import { ScoreBadge, nodeScore } from './score.jsx'
import { cycleNext } from './cycle.js'

// @@@ BoardStats - the per-node badges, COUNTED. A glanceable strip pinned to the graph's bottom-left that
// counts, across the WHOLE spec tree, the same glyphs each node tile already wears — so it adds no new
// visual vocabulary (the legend already decodes all of it) and needs no backend (every figure folds here
// from the same /api/board payload the graph polls). Three clusters answer three questions:
//   · composition — the four status dots, counted: what the tree IS (and how settled).
//   · attention   — nodes whose code is ahead of spec (⚠) + distinct open issues (◆): what NEEDS a human.
//   · coverage    — the yatsu score circles, counted: how well-MEASURED the tree is.
// Every figure is a count of DISTINCT things, never a sum of badges: an issue linked to N nodes is ONE
// issue (deduped by number), and a node ahead of spec counts once — summing per-node badges would multi-
// count both (a shared file like styles.css drifts under all its owners). Each chip is a WALK, not a single
// jump: clicking it steps focus to the NEXT node it counts (cycleNext from the current focus — the same
// ring primitive the o/O overlay cycle uses), so a repeated click cycles through them all, drilling each
// node's spine open and panning the camera to it. A zero-count chip dims and goes inert.

const STATUS_ORDER = ['merged', 'active', 'drift', 'pending']
// the score circles to surface: pass/fail are always shown as anchors (dim at 0); the stale + blind states
// appear only when present. Each renders the SAME ringed ScoreBadge the tiles use, so stale reads as the
// greyed verdict INSIDE the ring (grey ✓ / grey ✗), never an invented glyph.
const SCORE_VIEW = [
  { state: 'pass', always: true, titleKey: 'scorePass' },
  { state: 'fail', always: true, titleKey: 'scoreFail' },
  { state: 'stalePass', always: false, titleKey: 'scoreStalePass' },
  { state: 'staleFail', always: false, titleKey: 'scoreStaleFail' },
  { state: 'empty', always: false, titleKey: 'scoreEmpty' },
]

// one pass over the full node list → per category, the node ids (board order) that belong to it. A chip
// counts ids.length (or, for issues, the deduped issue total) and WALKS the ids on click. Issues are special:
// the count is distinct open issues (Set of numbers), but the walk ring is the nodes carrying them.
function summarize(specs) {
  const status = { merged: [], active: [], drift: [], pending: [] }
  const driftIds = []
  const issueIds = []
  const issueNumbers = new Set()
  const score = { pass: [], fail: [], stalePass: [], staleFail: [], empty: [] }
  for (const n of specs) {
    if (status[n.status]) status[n.status].push(n.id)
    if (n.drift > 0) driftIds.push(n.id)                          // node whose code is ahead of spec
    const open = n.openIssues || []
    if (open.length) { issueIds.push(n.id); for (const i of open) issueNumbers.add(i.number) }
    const st = nodeScore(n.scenarios, n.evals)                    // scenario-aware; null when no yatsu.md
    if (st && score[st]) score[st].push(n.id)
  }
  return { total: specs.length, status, driftIds, issueIds, issueCount: issueNumbers.size, score }
}

// one stat chip: a glyph (children) + its count. Clicking WALKS focus to the next id in its ring (entering
// at the first when focus is outside it); a chip with an empty ring dims and ignores clicks. `count` is shown
// verbatim — it equals ids.length for every chip except issues, where it is the deduped distinct-issue total.
function Stat({ count, ids, focusId, onJump, title, cls = '', children }) {
  const live = ids.length > 0
  return (
    <button type="button" className={`bstat ${cls}`.trim()} disabled={!live} title={title}
      onClick={live ? () => onJump(cycleNext(ids, focusId)) : undefined}>
      {children}{count}
    </button>
  )
}

export default function BoardStats({ specs, focusId, onJump }) {
  const t = useT()
  const s = useMemo(() => summarize(specs), [specs])
  const jump = (id) => id && onJump?.(id)
  return (
    <div className="board-stats" role="group" aria-label={t('stats.aria')}>
      {/* composition — the four status dots, counted. The leading number is the whole tree's size. */}
      <span className="bstat-total" title={t('stats.totalTitle', { n: s.total })}>{s.total}</span>
      {STATUS_ORDER.map((k) => (
        <Stat key={k} count={s.status[k].length} ids={s.status[k]} focusId={focusId} onJump={jump}
          title={t('stats.statusTitle', { n: s.status[k].length, status: t(`status.${k}`) })}>
          <span className="bstat-dot" style={{ background: STATUS[k].color }} />
        </Stat>
      ))}

      <span className="bstat-sep" />

      {/* attention — nodes whose code is ahead of spec (⚠) + DISTINCT open issues (◆), both deduped. */}
      <Stat count={s.driftIds.length} ids={s.driftIds} focusId={focusId} onJump={jump} cls="bstat-drift"
        title={t('stats.driftTitle', { n: s.driftIds.length })}>⚠</Stat>
      <Stat count={s.issueCount} ids={s.issueIds} focusId={focusId} onJump={jump} cls="bstat-issue"
        title={t('stats.issueTitle', { n: s.issueCount })}>◆</Stat>

      <span className="bstat-sep" />

      {/* coverage — the yatsu score circles, counted. Same ringed ScoreBadge as the tiles (one vocabulary):
          a stale verdict is the greyed mark INSIDE the ring; the empty ring is a declared-but-unmeasured
          blind spot. pass/fail anchor the row; stale/blind states show only when present. */}
      {SCORE_VIEW.map(({ state, always, titleKey }) => {
        const ids = s.score[state]
        if (!ids.length && !always) return null
        return (
          <Stat key={state} count={ids.length} ids={ids} focusId={focusId} onJump={jump}
            title={t(`stats.${titleKey}`, { n: ids.length })}>
            <ScoreBadge state={state} />
          </Stat>
        )
      })}
    </div>
  )
}
