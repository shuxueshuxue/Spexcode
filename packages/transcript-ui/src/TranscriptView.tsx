import { useEffect, useState } from 'react'
import { useTranscriptUi } from './context.js'
import { Caret } from './icons.js'
import { Quote } from './Quote.js'
import { parseEnvelope } from './envelope.js'
import { segments, type AnyTurn, type Segment, type WorkSegment as Work } from './segments.js'
import { ToolRun } from './ToolLine.js'
import { useDisclosure } from './useDisclosure.js'
import { runKinds, type AnyTool } from './vocabulary.js'

type Disclosure = { openIds: ReadonlySet<string>; onToggle: (id: string) => void }

// the agent IS the page: full measure, no bubble, no tint
export function TurnBody({ turn, openIds, onToggle, live, fold = true }: { turn: AnyTurn; live: boolean; fold?: boolean } & Disclosure) {
  const { renderText } = useTranscriptUi()
  return <div className="tx-say">
    {turn.text && <div className="tx-say-text">{renderText(turn.text)}</div>}
    <ToolRun tools={turn.tools} openIds={openIds} onToggle={onToggle} live={live} fold={fold} />
  </div>
}

// a quoted turn is read through the envelope rows: the sender it names, the body it carried
export function QuotedTurn({ turn }: { turn: AnyTurn }) {
  const { envelopes } = useTranscriptUi()
  const envelope = parseEnvelope(turn.text || '', envelopes)
  return <Quote who={envelope.who} ts={envelope.at ?? turn.at} text={envelope.body} className="tx-quote-nested" />
}

// A FOLD IS A MOVEMENT, and a fold that is only a re-render cannot move: React drops the work the instant a
// segment folds — when the agent speaks, or when the next message ends the stretch — so the page arrives at the
// row without ever travelling to it. This keeps the outgoing content mounted for exactly one duration so the
// collapse is visible, and it is the same hook that opens and shuts the fold's own body. Two details are load
// bearing. The phase is decided during the render that flips, not in an effect: an effect runs after paint, so
// the reader would see the jump first and the animation afterwards. And the flag can never outlive its timer,
// because a flag that survived would leave a second copy of the work standing on the page.
//
// The duration lives in both layers by necessity: the keyframe is CSS (`--tx-dur-fold`) and the unmount is JS.
// They are the same number, and this is the one place the JS half says it.
const FOLD_MS = 170
function useFold(open: boolean): [boolean, boolean] {
  const [was, setWas] = useState(open)
  const [phase, setPhase] = useState<'' | 'in' | 'out'>('')
  if (was !== open) { setWas(open); setPhase(open ? 'in' : 'out') }
  useEffect(() => {
    if (!phase) return undefined
    const timer = setTimeout(() => setPhase(''), FOLD_MS)
    return () => clearTimeout(timer)
  }, [phase])
  return [phase === 'out', phase === 'in']
}

export function WorkSegmentView({ segment, openIds, onToggle, live }: { segment: Work; live: boolean } & Disclosure) {
  const { labels, vocabulary } = useTranscriptUi()
  const id = `seg:${segment.work[0]?.id || segment.answer?.id}`
  const open = openIds.has(id)
  const [folding] = useFold(!segment.folded)   // the work is on its way behind the row
  const [shutting, opening] = useFold(open)    // the row's own disclosure
  const kinds = runKinds(segment.work.flatMap((turn): readonly AnyTool[] => turn.tools ?? []), vocabulary)
  const foldedCalls = segment.work.reduce((n, turn) => n + (turn.tools?.length || 0), 0)
  // a fold must not hide a failure: the row counts the calls whose harness recorded one
  const failedCalls = segment.work.reduce((n, turn) => n + (turn.tools?.filter((tool) => tool.outcome).length || 0), 0)
  // history folds its runs; the work in progress (a live segment's calls after its newest prose) does not
  const history = !segment.now || !!segment.answer
  const process = (fold: boolean) => segment.work.map((turn) =>
    <TurnBody key={turn.id} turn={turn} openIds={openIds} onToggle={onToggle} live={live} fold={fold} />)
  return <>
    {segment.folded ? (
      <div className={`tx-work${failedCalls ? ' is-failed' : ''}${folding ? ' is-folding' : ''}`}>
        <button type="button" className="tx-work-row" aria-expanded={open} onClick={() => onToggle(id)}>
          <span className="tx-work-lead">{labels.toolUses(foldedCalls)}</span>
          {kinds && <span className="tx-work-detail">{kinds}</span>}
          {failedCalls > 0 && <span className="tx-tool-outcome is-failed">{labels.failedCount(failedCalls)}</span>}
          <Caret open={open} className="tx-work-caret" />
        </button>
        {/* the collapse draws the work exactly as the frame before the fold drew it — a live segment's calls
            were sentences, a closed one's runs were already folded — so the movement starts from what was there */}
        {folding && <div className="tx-fold is-closing"><div className="tx-flow">{process(!live)}</div></div>}
        {(open || shutting) && <div className={`tx-fold${opening ? ' is-opening' : ''}${shutting ? ' is-closing' : ''}`}>
          <div className="tx-work-body">{process(true)}</div>
        </div>}
      </div>
    ) : process(history)}
    {segment.answer && <TurnBody turn={segment.answer} openIds={openIds} onToggle={onToggle} live={live} fold={!segment.now} />}
    {segment.after.map((turn) => <TurnBody key={turn.id} turn={turn} openIds={openIds} onToggle={onToggle} live={live} fold={!segment.now} />)}
  </>
}

export function SegmentView({ segment, ...rest }: { segment: Segment; live: boolean } & Disclosure) {
  if (segment.kind === 'quote') return <QuotedTurn turn={segment.turn} />
  return <WorkSegmentView segment={segment} {...rest} />
}

// THE TURNS, in the grammar: quotes where the host wants them, work segments folded behind their answers
export function TranscriptTurns({ turns, openIds, onToggle, live = false }: { turns: readonly AnyTurn[]; live?: boolean } & Disclosure) {
  const { fold, runMin, userTurns } = useTranscriptUi()
  return <>{segments(turns, { live, fold, runMin, userTurns }).map((segment, index) =>
    <SegmentView key={segment.kind === 'quote' ? `q:${segment.turn.id}` : `w:${segment.work[0]?.id ?? segment.answer?.id ?? index}`} segment={segment} openIds={openIds} onToggle={onToggle} live={live} />)}</>
}

export type TranscriptPayload = Readonly<{
  turns: readonly AnyTurn[]
  truncated?: boolean
  omittedTurns?: number
  omittedBytes?: number
  outOfOrderEvents?: number
}>

// THE WHOLE PAYLOAD: one interval's turns, the same shape a closed read returns and a merged live stream
// holds, so one renderer draws history and the tail alike. `live` adds exactly one truth — a call without a
// recorded result is still running — and keeps the work in progress unfolded.
export function TranscriptView({ data, live = false, className = '' }: { data: TranscriptPayload | null | undefined; live?: boolean; className?: string }) {
  const { labels } = useTranscriptUi()
  const [openIds, toggle] = useDisclosure()
  if (!data?.turns?.length) return <div className={`tx tx-empty${className ? ` ${className}` : ''}`}>{labels.empty}</div>
  return <div className={`tx tx-flow${className ? ` ${className}` : ''}`}>
    <TranscriptTurns turns={data.turns} openIds={openIds} onToggle={toggle} live={live} />
    {data.truncated && <div className="tx-truncated">{labels.truncated({ omittedTurns: data.omittedTurns || 0, omittedBytes: data.omittedBytes || 0, outOfOrderEvents: data.outOfOrderEvents || 0 })}</div>}
  </div>
}
