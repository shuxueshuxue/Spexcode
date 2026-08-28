import { useState } from 'react'
import { RUN_MIN, runKinds, splitTarget, toolTarget, toolVerb } from './toolVocabulary.js'
import RichText from './RichText.js'
import { BlobMedia } from './Evidence.jsx'
import { routeHash } from './route.js'
import { newTabAnchor } from './tabs.js'
import { Caret, Icon } from './icons.jsx'
import { useT } from './i18n/index.jsx'
import { splitEnvelope } from './conversationItems.js'

// THE ONE TRANSCRIPT RENDERER. A closed seam's history and the open seam's live tail are the same payload —
// the adapter's normalized turns for one interval ([[transcript-reader]]) — so they are drawn by the same
// components: the person quoted, the agent as the page, a tool call as a sentence. The only thing "live" adds
// is truth about time: a call whose result has not been recorded yet is still running, and says so.

// The transcript is the one message surface in the dashboard: a newline here was typed by a person or an
// agent mid-conversation, not wrapped by an editor, so it stays a line break instead of reflowing.
export function TimelineRichText({ children, className = '' }) {
  return <RichText className={className} softBreak="break"
    renderSpecRef={(id, token, provenance) => {
      const href = routeHash('spec', id)
      return <a className="doc-link" href={href} {...provenance} onClick={(event) => newTabAnchor(event, href)}>{id}</a>
    }}
    renderEvidence={(meta, token, provenance) => <span className="rich-evidence" {...provenance}><BlobMedia hash={meta.hash} alt={meta.alt || 'evidence'} /></span>}>
    {children}
  </RichText>
}

// a call is running until the harness recorded its result; only a LIVE reading may say so — a closed
// interval that ends before the result was written is history, not something still happening
export const isRunning = (tool, live) => live && tool.output === undefined

// One tool call as a SENTENCE, not a card: verb, target, and the size of what came back. It is
// `inline-flex` so a dozen of them read as a list of things that happened rather than a dozen boxes.
// There is no success mark, because the transcript carries no per-tool status — the past-tense verb is the
// whole claim, and it is one we can actually make. A running call wears a small spinner and the word.
export function ToolLine({ tool, open, onToggle, live = false }) {
  const t = useT()
  const target = toolTarget(tool.input)
  const { lead, trail } = splitTarget(target)
  const lines = tool.outputLines || 0
  const canOpen = !!tool.output
  const running = isRunning(tool, live)
  const Row = canOpen ? 'button' : 'div'
  return (
    <div className={`tc-tool${running ? ' is-running' : ''}`}>
      <Row {...(canOpen ? { type: 'button', onClick: onToggle, 'aria-expanded': open } : {})}
        className={`tc-tool-row${canOpen ? ' is-openable' : ''}`}>
        <span className="tc-tool-verb">{toolVerb(tool.name)}</span>
        {lead && <span className="tc-tool-target">{lead}</span>}
        {trail && <span className="tc-tool-trail">{trail}</span>}
        {lines > 0 && <span className="tc-tool-size">{lines} lines</span>}
        {running && <span className="tc-tool-running"><Icon name="loader" size={11} className="tc-tool-spin" />{t('session.executionRunning')}</span>}
        {canOpen && <Caret open={open} className="tc-tool-caret" />}
      </Row>
      {open && canOpen && <pre className="tc-tool-out">{tool.output}</pre>}
    </div>
  )
}

// A turn's tool calls are consecutive by construction, so "a run" is just "this turn's calls". Three or
// more fold to one row; one or two stay sentences, where the verb and target are worth reading on sight.
// Measured against a real transcript — 39 calls in one turn, all the same tool — the noise a reader wants
// gone is repetition, not any particular tool, and nothing here judges what a call DID.
export function ToolRun({ tools, openIds, onToggle, live = false }) {
  if (!tools?.length) return null
  const line = (tool) => (
    <ToolLine key={tool.id} tool={tool} open={openIds.has(tool.id)} onToggle={() => onToggle(tool.id)} live={live} />
  )
  if (tools.length < RUN_MIN) return <div className="tc-tools">{tools.map(line)}</div>
  const id = `run:${tools[0].id}`
  const open = openIds.has(id)
  const running = tools.some((tool) => isRunning(tool, live))
  return <div className="tc-tools">
    <div className={`tc-tool${running ? ' is-running' : ''}`}>
      <button type="button" className="tc-tool-row is-openable is-run" aria-expanded={open}
        onClick={() => onToggle(id)}>
        <span className="tc-tool-verb">{tools.length} tool uses</span>
        <span className="tc-tool-trail">{runKinds(tools)}</span>
        <Caret open={open} className="tc-tool-caret" />
      </button>
      {open && <div className="tc-tool-kids">{tools.map(line)}</div>}
    </div>
  </div>
}

// WHERE THE FOLD BELONGS, decided by what a real transcript looks like rather than by what seemed likely.
//
// The first attempt folded a run of tool calls inside ONE assistant turn. Measured against a real session:
// 39 calls spread across 21 assistant turns, one or two each — so that fold never fired and the reader
// still scrolled 21 blocks of work to reach one answer. The repetition is BETWEEN turns, not within them.
//
// So the unit is the work SEGMENT: a consecutive run of assistant turns, ending at the last one that
// actually says something. Everything before that is how the answer was produced; the last turn is the
// answer. Collapse the process, keep the result — a finished segment is one line plus what it concluded.
export function segments(turns) {
  const out = []
  let run = []
  const flush = () => {
    if (!run.length) return
    const calls = run.reduce((n, turn) => n + (turn.tools?.length || 0), 0)
    let lead = run.length - 1
    while (lead > 0 && !run[lead].text) lead -= 1
    const answer = run[lead]?.text ? run[lead] : null
    const work = answer ? run.slice(0, lead) : run
    out.push({ kind: 'work', work, answer, calls, folded: calls >= RUN_MIN && work.length > 0 })
    run = []
  }
  for (const turn of turns) {
    if (turn.role === 'user') { flush(); out.push({ kind: 'ask', turn }); continue }
    run.push(turn)
  }
  flush()
  return out
}

function TurnBody({ turn, openIds, onToggle, live }) {
  return <div className="tc-say">
    {turn.text && <div className="tc-say-text"><TimelineRichText>{turn.text}</TimelineRichText></div>}
    <ToolRun tools={turn.tools} openIds={openIds} onToggle={onToggle} live={live} />
  </div>
}

function WorkSegment({ segment, openIds, onToggle, live }) {
  const id = `seg:${segment.work[0]?.id || segment.work[0]?.at || segment.answer?.at}`
  const open = openIds.has(id)
  const kinds = runKinds(segment.work.flatMap((turn) => turn.tools || []))
  return <>
    {segment.folded ? (
      <div className="tc-work">
        <button type="button" className="tc-work-row" aria-expanded={open} onClick={() => onToggle(id)}>
          <span className="tc-work-lead">{segment.calls} tool uses</span>
          {kinds && <span className="tc-work-detail">{kinds}</span>}
          <Caret open={open} className="tc-work-caret" />
        </button>
        {open && <div className="tc-work-body">
          {segment.work.map((turn, i) => <TurnBody key={`t${i}`} turn={turn} openIds={openIds} onToggle={onToggle} live={live} />)}
        </div>}
      </div>
    ) : segment.work.map((turn, i) => <TurnBody key={`t${i}`} turn={turn} openIds={openIds} onToggle={onToggle} live={live} />)}
    {segment.answer && <TurnBody turn={segment.answer} openIds={openIds} onToggle={onToggle} live={live} />}
  </>
}

// one disclosure set per rendered payload: what the reader opened stays open across live refreshes of the
// same interval, because ids are the transcript's own (tool ids, turn ids), not render positions
export function useDisclosure() {
  const [openIds, setOpenIds] = useState(() => new Set())
  const toggle = (id) => setOpenIds((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  return [openIds, toggle]
}

// hour:minute for a quoted row; the timeline's day separators live beside it in TimelineChat
export const timeOf = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

// A long quote is clamped at first sight — the conversation is about what came after it. The trigger is the
// text itself rather than a measured height, so the row never reflows after paint.
const isLongQuote = (text) => text.length > 700 || (text.match(/\n/g) || []).length > 10

// The person is QUOTED: a bubble off to its own side, the one grammar the timeline shares with the transcript
// inside a seam. The peer's name sits on the bubble; the human's has none, and the envelope never shows.
export function Quote({ who, ts, text, className = '' }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const clamped = !open && isLongQuote(text)
  return (
    <div className={`m-quote${clamped ? ' is-clamped' : ''}${className ? ` ${className}` : ''}`}>
      {(who || ts) && (
        <div className="m-quote-head">
          {who && <span className="m-quote-who">{who}</span>}
          {ts && <time className="m-tin">{timeOf(ts)}</time>}
        </div>
      )}
      <div className="m-ev-text"><TimelineRichText>{text}</TimelineRichText></div>
      {clamped && <button type="button" className="m-quote-more" onClick={() => setOpen(true)}>{t('mobile.more')}</button>}
    </div>
  )
}

// THE CONVERSATION, SHAPED AS ONE. A person's turn is quoted — a narrow bubble with one corner squared off
// — and the agent's turn IS the page: full measure, no bubble, no tint. The asymmetry is the design; giving
// both a box makes a chat read as a table of two columns.
export function TranscriptPayload({ data, live = false }) {
  const [openIds, toggle] = useDisclosure()
  if (!data?.turns?.length) return <div className="m-transcript-empty">transcript 已读取：该区间没有 turn</div>
  return <div className="tc-flow">
    <TranscriptTurns turns={data.turns} openIds={openIds} onToggle={toggle} live={live} />
    {data.truncated && <div className="m-transcript-truncated">transcript 已截断：省略 {data.omittedTurns || 0} turns、{data.omittedBytes || 0} bytes{data.outOfOrderEvents ? `，检测到 ${data.outOfOrderEvents} 条乱序记录` : ''}</div>}
  </div>
}

export function TranscriptTurns({ turns, openIds, onToggle, live = false }) {
  return segments(turns).map((segment, index) => {
    if (segment.kind !== 'ask') return <WorkSegment key={`w${index}`} segment={segment} openIds={openIds} onToggle={onToggle} live={live} />
    const { text, envelope } = splitEnvelope(segment.turn.text || '')
    return <Quote key={`a${index}`} className="tc-ask" who={envelope?.label || null} text={text} />
  })
}
