import { useMemo } from 'react'
import { useT } from './i18n/index.jsx'
import { STATUS } from './SpecNode.jsx'
import { STATUS_ORDER, summarizeBoard } from './specMeta.js'
import { ScoreBadge } from './score.jsx'
import { cycleNext } from './cycle.js'
import { useStatusItem } from './StatusBar.jsx'

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

// The per-category pass over the node list is `summarizeBoard`, and it lives in `specMeta.js` rather than
// here: the ambient status bar has to say the same numbers on routes that never mount a graph, and reading
// them from this file would drag @xyflow/react into every chunk. One derivation, two readers.

// one stat chip: a glyph (children) + its count. Clicking WALKS focus to the next id in its ring (entering
// at the first when focus is outside it); a chip with an empty ring dims and ignores clicks. `count` is shown
// verbatim and need not equal ids.length: issues count distinct issue numbers, coverage counts scenarios —
// both over a node ring that may be shorter than the count (and, for coverage, a count>0 always has a ring).
function Stat({ count, ids, focusId, onJump, title, cls = '', children }) {
  const live = ids.length > 0
  return (
    <button type="button" className={`bstat ${cls}`.trim()} disabled={!live} data-tip={title} aria-label={title}
      onClick={live ? () => onJump(cycleNext(ids, focusId)) : undefined}>
      {children}{count}
    </button>
  )
}

// The tally is the FOCUSED VIEW's state, so it registers on the status bar's right group rather than
// floating over the canvas. It renders nothing itself: the component's whole output is one registered item,
// which is what lets it stop knowing where on the screen it lands — and what freed the session window from
// reserving height for a strip that used to sit under it.
export default function GraphStats({ specs, focusId, onJump }) {
  const t = useT()
  const s = useMemo(() => summarizeBoard(specs), [specs])
  const jump = (id) => id && onJump?.(id)
  useStatusItem({
    id: 'graph-stats',
    side: 'right',
    priority: 50,
    tooltip: t('stats.aria'),
    node: (
      <span className="graph-stats" role="group" aria-label={t('stats.aria')}>
      {/* composition — the four status dots, counted. The leading number is the whole tree's size. */}
      <span className="bstat-total" data-tip={t('stats.totalTitle', { n: s.total })}>{s.total}</span>
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

      {/* coverage — the eval score circles, counting SCENARIOS. The number is scoreCount[state] (scenarios in
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
      </span>
    ),
  })
  return null
}
