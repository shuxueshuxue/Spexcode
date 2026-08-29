import { useTranscriptUi } from './context.js'
import { Caret } from './icons.js'
import { Quote } from './Quote.js'
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

export function WorkSegmentView({ segment, openIds, onToggle, live }: { segment: Work; live: boolean } & Disclosure) {
  const { labels, vocabulary } = useTranscriptUi()
  const id = `seg:${segment.work[0]?.id || segment.answer?.id}`
  const open = openIds.has(id)
  const kinds = runKinds(segment.work.flatMap((turn): readonly AnyTool[] => turn.tools ?? []), vocabulary)
  const foldedCalls = segment.work.reduce((n, turn) => n + (turn.tools?.length || 0), 0)
  // a fold must not hide a failure: the row counts the calls whose harness recorded one
  const failedCalls = segment.work.reduce((n, turn) => n + (turn.tools?.filter((tool) => tool.outcome).length || 0), 0)
  // history folds its runs; the work in progress (a live segment's calls after its newest prose) does not
  const history = !segment.now || !!segment.answer
  return <>
    {segment.folded ? (
      <div className={`tx-work${failedCalls ? ' is-failed' : ''}`}>
        <button type="button" className="tx-work-row" aria-expanded={open} onClick={() => onToggle(id)}>
          <span className="tx-work-lead">{labels.toolUses(foldedCalls)}</span>
          {kinds && <span className="tx-work-detail">{kinds}</span>}
          {failedCalls > 0 && <span className="tx-tool-outcome is-failed">{labels.failedCount(failedCalls)}</span>}
          <Caret open={open} className="tx-work-caret" />
        </button>
        {open && <div className="tx-work-body">
          {segment.work.map((turn) => <TurnBody key={turn.id} turn={turn} openIds={openIds} onToggle={onToggle} live={live} />)}
        </div>}
      </div>
    ) : segment.work.map((turn) => <TurnBody key={turn.id} turn={turn} openIds={openIds} onToggle={onToggle} live={live} fold={history} />)}
    {segment.answer && <TurnBody turn={segment.answer} openIds={openIds} onToggle={onToggle} live={live} fold={!segment.now} />}
    {segment.after.map((turn) => <TurnBody key={turn.id} turn={turn} openIds={openIds} onToggle={onToggle} live={live} fold={!segment.now} />)}
  </>
}

export function SegmentView({ segment, ...rest }: { segment: Segment; live: boolean } & Disclosure) {
  if (segment.kind === 'quote') return <Quote ts={segment.turn.at} text={segment.turn.text || ''} className="tx-quote-nested" />
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
