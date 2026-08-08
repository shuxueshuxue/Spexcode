import { useEffect, useState } from 'react'
import { subscribeSessionExecution } from './data.js'
import { Icon } from './icons.jsx'
import Modal from './Modal.jsx'
import { useT } from './i18n/index.jsx'

const STEP_ICON = { command: 'terminal', read: 'eye', write: 'pencil', search: 'search', tool: 'command' }

// This deliberately knows only the compact server contract. Harness transcript envelopes, tool arguments, and
// output remain adapter-private; adding an adapter changes no rendering branch here.
export default function ExecutionTrace({ sessionId, active }) {
  const t = useT()
  const [execution, setExecution] = useState(null)
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())

  useEffect(() => {
    if (!active) return undefined
    setExecution(null)
    return subscribeSessionExecution(sessionId, setExecution)
  }, [sessionId, active])
  useEffect(() => { if (!execution?.workingNote) setOpen(false) }, [execution?.workingNote])
  useEffect(() => setExpanded(new Set()), [execution?.revision])

  if (!execution?.workingNote) return null
  const toggleDetail = (id) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  return (
    <div className="m-execution-trace">
      <button type="button" className="m-execution-entry" onClick={() => setOpen(true)}
        aria-label={t('session.executionOpen')}>
        <Icon name="list-checks" size={15} />
        <span>{execution.workingNote}</span>
        <Icon name="chevron-right" size={15} />
      </button>
      {open && (
        <Modal title={t('session.executionTitle')} closeLabel={t('session.executionClose')}
          className="execution-trace-modal" onClose={() => setOpen(false)}>
          <div className="execution-note">{execution.workingNote}</div>
          <ol className="execution-steps">
            {execution.steps.length
              ? execution.steps.map((step) => {
                const hasDetail = !!step.detail
                const isExpanded = hasDetail && expanded.has(step.id)
                const detailId = `execution-step-${step.id}`
                const row = <>
                  <Icon name={STEP_ICON[step.kind] || 'command'} size={16} />
                  <span className="execution-step-label">{step.label}</span>
                  <span className="execution-step-state">{t(step.state === 'running' ? 'session.executionRunning' : 'session.executionDone')}</span>
                  {hasDetail && <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={15} />}
                </>
                return (
                  <li key={step.id} className={`execution-step ${step.state}${isExpanded ? ' expanded' : ''}`}>
                    {hasDetail
                      ? <button type="button" className="execution-step-toggle" onClick={() => toggleDetail(step.id)}
                        aria-expanded={isExpanded} aria-controls={detailId}>{row}</button>
                      : <div className="execution-step-row">{row}</div>}
                    {isExpanded && <div id={detailId} className="execution-step-detail">{step.detail}</div>}
                  </li>
                )
              })
              : <li className="execution-empty">{t('session.executionEmpty')}</li>}
          </ol>
        </Modal>
      )}
    </div>
  )
}
