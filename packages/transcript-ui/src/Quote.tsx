import { useState } from 'react'
import { useTranscriptUi } from './context.js'
import { timeOf } from './vocabulary.js'

// A long quote is clamped at first sight — the conversation is about what came after it. The trigger is the
// text itself rather than a measured height, so the row never reflows after paint.
const isLongQuote = (text: string): boolean => text.length > 700 || (text.match(/\n/g) || []).length > 10

// THE PERSON IS QUOTED: a bubble off to its own side, with one corner squared. The name sits on the bubble
// when the host knows it; the time shows only in a narrow pane, where there is no ruler beside the flow.
export function Quote({ who = null, ts = null, text, className = '' }: { who?: string | null; ts?: number | string | null; text: string; className?: string }) {
  const { renderText, labels } = useTranscriptUi()
  const [open, setOpen] = useState(false)
  const clamped = !open && isLongQuote(text)
  return (
    <div className={`tx tx-quote${clamped ? ' is-clamped' : ''}${className ? ` ${className}` : ''}`}>
      {(who || ts) && (
        <div className="tx-quote-head">
          {who && <span className="tx-quote-who">{who}</span>}
          {ts != null && <time className="tx-time">{timeOf(ts)}</time>}
        </div>
      )}
      <div className="tx-quote-text">{renderText(text)}</div>
      {clamped && <button type="button" className="tx-quote-more" onClick={() => setOpen(true)}>{labels.more}</button>}
    </div>
  )
}
