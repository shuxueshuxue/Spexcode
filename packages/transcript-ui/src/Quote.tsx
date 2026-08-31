import { useState } from 'react'
import { useTranscriptUi } from './context.js'
import { useOpenInPlace } from './openInPlace.js'
import { timeOf } from './vocabulary.js'

// A long quote is clamped at first sight — the conversation is about what came after it. The trigger is the
// text itself rather than a measured height, so the row never reflows after paint.
const isLongQuote = (text: string): boolean => text.length > 700 || (text.match(/\n/g) || []).length > 10

// THE PERSON IS QUOTED: a bubble off to its own side, with one corner squared. The name sits on the bubble
// when the host knows it; the time shows only in a narrow pane, where there is no ruler beside the flow.
export function Quote({ who = null, ts = null, text, className = '' }: { who?: string | null; ts?: number | string | null; text: string; className?: string }) {
  const { renderText, labels, suppressExpand } = useTranscriptUi()
  const [open, setOpen] = useState(false)
  const clamped = !open && isLongQuote(text)
  // opening grows the bubble; without this the scroller slides by that growth and takes the reader with it
  const { ref, mark } = useOpenInPlace<HTMLDivElement>(open)
  // THE WHOLE CLAMPED BLOCK IS THE TARGET, not a word in its corner. What is hidden is the block, so the
  // block is what a reader presses; `more` stays as the mark that says so. A press that ENDED A SELECTION
  // is a reader taking the text, not asking for the rest, and the host is the one that can tell.
  const expand = clamped ? () => { if (!suppressExpand()) { mark(); setOpen(true) } } : undefined
  return (
    <div ref={ref} className={`tx tx-quote${clamped ? ' is-clamped' : ''}${className ? ` ${className}` : ''}`}
      onClick={expand}>
      {(who || ts) && (
        <div className="tx-quote-head">
          {who && <span className="tx-quote-who">{who}</span>}
          {ts != null && <time className="tx-time">{timeOf(ts)}</time>}
        </div>
      )}
      <div className="tx-quote-text">{renderText(text)}</div>
      {/* still a real button so the keyboard has a target; the press it receives is the same one the block takes */}
      {clamped && <button type="button" className="tx-quote-more" aria-expanded={false}>{labels.more}</button>}
    </div>
  )
}
