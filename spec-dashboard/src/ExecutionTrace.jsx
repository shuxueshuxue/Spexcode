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

  useEffect(() => {
    if (!active) return undefined
    setExecution(null)
    return subscribeSessionExecution(sessionId, setExecution)
  }, [sessionId, active])
  useEffect(() => { if (!execution?.workingNote) setOpen(false) }, [execution?.workingNote])

  if (!execution?.workingNote) return null
  return (
    <>
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
              ? execution.steps.map((step) => (
                <li key={step.id} className={`execution-step ${step.state}`}>
                  <Icon name={STEP_ICON[step.kind] || 'command'} size={16} />
                  <span className="execution-step-copy">
                    <span className="execution-step-label">{step.label}</span>
                    {step.detail && <span className="execution-step-detail">{step.detail}</span>}
                  </span>
                  <span className="execution-step-state">{t(step.state === 'running' ? 'session.executionRunning' : 'session.executionDone')}</span>
                </li>
              ))
              : <li className="execution-empty">{t('session.executionEmpty')}</li>}
          </ol>
        </Modal>
      )}
    </>
  )
}
