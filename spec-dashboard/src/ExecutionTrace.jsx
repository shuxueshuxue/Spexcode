import { useEffect, useRef, useState } from 'react'
import { subscribeSessionExecution } from './data.js'
import { Icon } from './icons.jsx'
import { useT } from './i18n/index.jsx'

const STEP_ICON = { command: 'terminal', read: 'eye', write: 'pencil', search: 'search', tool: 'command' }
const squash = (text) => (text || '').replace(/\s+/g, ' ').trim()

// THE LIVE TAIL SAYS NOTHING THE RECORD ALREADY SAID. The trace's working note is the agent's newest prose in
// the current turn; the moment the agent declares that prose as its status note, the durable timeline draws
// it as a message one row above — and the same sentence twice, once as history and once as "now", is the
// duplication a reader notices first. The note is elided when the newest message already carries it (the
// backend clips a note at 240 chars, so either side may be the prefix of the other).
export const noteAlreadySaid = (note, said) => {
  const n = squash(note).replace(/(\.\.\.|…)$/, '')
  const s = squash(said)
  return !!n && !!s && (s.startsWith(n) || n.startsWith(s))
}

// [[message-stream]]: the current turn, drawn IN the conversation rather than behind a door. It is the same
// grammar the transcript already reads in — the note as agent prose, each tool step as a sentence — so the
// live tail and the folded history look like one flow, and the only thing that marks it as live is a caret
// and a spinner. This deliberately knows only the compact server contract: harness envelopes, tool arguments
// and output stay adapter-private, and adding an adapter changes no rendering branch here.
export default function ExecutionTrace({ sessionId, active, live = false, lastSaid = null, onTurnSettled }) {
  const t = useT()
  const [execution, setExecution] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())

  useEffect(() => {
    if (!active) return undefined
    setExecution(null)
    return subscribeSessionExecution(sessionId, setExecution)
  }, [sessionId, active])
  // a same-turn revision keeps what the reader opened, whatever it revised — a later note, a step that
  // finished; only a changed turn (or a changed session) starts disclosure closed. Steps a new note brings
  // carry new ids, so they start closed by construction without wiping what is still on screen.
  useEffect(() => setExpanded(new Set()), [sessionId, execution?.turnId])
  // The instant the trace empties, the turn has settled and the durable record most likely just gained the
  // note that replaces it — so the timeline is asked to catch up now, not at its next poll.
  const hadNote = useRef(false)
  useEffect(() => {
    const has = !!execution?.workingNote
    if (hadNote.current && !has) onTurnSettled?.()
    hadNote.current = has
  }, [execution?.workingNote, onTurnSettled])

  if (!execution?.workingNote) return null
  const repeated = noteAlreadySaid(execution.workingNote, lastSaid)
  const steps = execution.steps || []
  const running = steps.some((step) => step.state === 'running')
  // said, and nothing still running: the record has it and the seam above keeps the folded history
  if (repeated && !running) return null

  const toggleDetail = (id) => setExpanded((current) => {
    const next = new Set(current)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  return (
    <div className={`m-execution${live ? ' is-live' : ''}`} data-revision={execution.revision}>
      {!repeated && <div className="m-execution-note" key={execution.workingNote}>{execution.workingNote}</div>}
      {steps.length > 0 && (
        <ol className="tc-tools m-execution-steps">
          {steps.map((step) => {
            const hasDetail = !!step.detail
            const open = hasDetail && expanded.has(step.id)
            const detailId = `execution-step-${step.id}`
            const Row = hasDetail ? 'button' : 'div'
            return (
              <li key={step.id} className={`tc-tool m-execution-step is-${step.state}`}>
                <Row {...(hasDetail ? { type: 'button', onClick: () => toggleDetail(step.id), 'aria-expanded': open, 'aria-controls': detailId } : {})}
                  className={`tc-tool-row${hasDetail ? ' is-openable' : ''}`}>
                  <Icon name={STEP_ICON[step.kind] || 'command'} size={12} className="m-execution-kind" />
                  <span className="tc-tool-verb">{step.label}</span>
                  {step.state === 'running' && (
                    <span className="m-execution-running"><Icon name="loader" size={11} className="m-execution-spin" />{t('session.executionRunning')}</span>
                  )}
                  {hasDetail && <span className="tc-tool-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>}
                </Row>
                {open && <div id={detailId} className="m-execution-detail">{step.detail}</div>}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
