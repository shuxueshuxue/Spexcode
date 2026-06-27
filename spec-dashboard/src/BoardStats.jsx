import { useMemo } from 'react'
import { useT } from './i18n/index.jsx'
import { STATUS } from './SpecNode.jsx'
import { ScoreBadge, scenarioStates } from './score.jsx'
import { cycleNext } from './cycle.js'

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

// one pass over the full node list → per category, the node ids (board order) that belong to it. Most chips
// count ids.length and WALK those ids on click. Two chips decouple the count from the ring: issues count the
// DEDUPED distinct open-issue total (Set of numbers) while walking the nodes carrying them; coverage counts
// SCENARIOS (scoreCount) while walking the nodes that own them (scoreNodes — a node enters each state's ring
// once, however many of its scenarios sit there). `missing` (declared but never measured) folds into empty.
function summarize(specs) {
  const status = { merged: [], active: [], drift: [], pending: [] }
  const driftIds = []
  const issueIds = []
  const issueNumbers = new Set()
  const scoreCount = { pass: 0, fail: 0, stalePass: 0, staleFail: 0, empty: 0 }     // scenarios per state (the shown number)
  const scoreNodes = { pass: [], fail: [], stalePass: [], staleFail: [], empty: [] } // nodes owning ≥1 such scenario (the walk ring)
  for (const n of specs) {
    if (status[n.status]) status[n.status].push(n.id)
    if (n.drift > 0) driftIds.push(n.id)                          // node whose code is ahead of spec
    const open = n.openIssues || []
    if (open.length) { issueIds.push(n.id); for (const i of open) issueNumbers.add(i.number) }
    const seen = new Set()
    for (const sc of scenarioStates(n.scenarios, n.evals)) {      // [] when no yatsu.md
      const bucket = sc.state === 'missing' ? 'empty' : sc.state
      if (scoreCount[bucket] === undefined) continue
      scoreCount[bucket]++
      if (!seen.has(bucket)) { seen.add(bucket); scoreNodes[bucket].push(n.id) }
    }
  }
  return { total: specs.length, status, driftIds, issueIds, issueCount: issueNumbers.size, scoreCount, scoreNodes }
}

// one stat chip: a glyph (children) + its count. Clicking WALKS focus to the next id in its ring (entering
// at the first when focus is outside it); a chip with an empty ring dims and ignores clicks. `count` is shown
// verbatim and need not equal ids.length: issues count distinct issue numbers, coverage counts scenarios —
// both over a node ring that may be shorter than the count (and, for coverage, a count>0 always has a ring).
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

      {/* coverage — the yatsu score circles, counting SCENARIOS. The number is scoreCount[state] (scenarios in
          that state); the walk ring is scoreNodes[state] (the nodes owning them). Same ringed ScoreBadge as the
          tiles (one vocabulary): a stale verdict is the greyed mark INSIDE the ring; the empty ring is a
          declared-but-unmeasured blind spot. pass/fail anchor the row; stale/blind states show only when present. */}
      {SCORE_VIEW.map(({ state, always, titleKey }) => {
        const count = s.scoreCount[state]
        const ids = s.scoreNodes[state]
        if (!count && !always) return null
        return (
          <Stat key={state} count={count} ids={ids} focusId={focusId} onJump={jump}
            title={t(`stats.${titleKey}`, { n: count })}>
            <ScoreBadge state={state} />
          </Stat>
        )
      })}
    </div>
  )
}
