import { useState } from 'react'
import Modal from './Modal.jsx'
import { apiFetch } from './data.js'
import { useEscLayer } from './escStack.js'
import { IconButton } from './icons.jsx'
import { useT } from './i18n/index.jsx'

// The multi-select mode's top bar ([[session-multi-select]]): a live pick count + adjacent icon actions for
// bulk archive and close. It owns one confirm + endpoint fan-out per verb, but NOT the picking itself — which
// rows are ticked lives in the list ([[session-console]]); this bar only reads the ids and acts on them.
export default function SessionSelectBar({ ids, onCancel, onClosed, onError }) {
  const t = useT()
  const [confirming, setConfirming] = useState(null)
  const count = ids.length

  useEscLayer(!!confirming, () => setConfirming(null))

  // Dismiss the confirm AT ONCE and fire every selected lifecycle request in the background. The exact
  // per-row endpoint stays authoritative; this bar merely fans it out and reports every refusal together.
  const confirmAction = () => {
    const verb = confirming
    setConfirming(null)
    Promise.all(ids.map(async (id) => {
      try {
        const response = await apiFetch(`/api/sessions/${id}/${verb}`, {
          method: 'POST', headers: verb === 'archive' ? { 'Content-Type': 'application/json' } : undefined,
          ...(verb === 'archive' ? { body: JSON.stringify({ on: true }) } : {}),
        })
        const body = await response.json().catch(() => null)
        return !response.ok || body?.ok === false ? body?.error || `session ${verb} refused (HTTP ${response.status})` : null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    })).then((results) => {
      const failures = results.filter(Boolean)
      if (failures.length) onError?.(failures.join('\n'))
    }).finally(() => onClosed?.())
  }

  return (
    <>
      <div className="si-selbar">
        <span className="si-selcount">{t('sessionSelect.selected', { n: count })}</span>
        <IconButton icon="star" size={14} className="si-select-action danger" label={t('sessionSelect.archive')}
          disabled={count === 0} onClick={() => setConfirming('archive')} />
        <IconButton icon="trash" size={14} className="si-select-action danger" label={t('sessionSelect.close')}
          disabled={count === 0} onClick={() => setConfirming('close')} />
        <button type="button" className="sess-rename-btn" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
      {confirming && (
        <Modal
          title={t(`sessionSelect.${confirming}Title`, { n: count })}
          closeLabel={t('common.close')}
          className="sess-rename-modal"
          onClose={() => setConfirming(null)}
        >
          <div className="sess-confirm">
            <p className="sess-confirm-msg">{t(`sessionSelect.${confirming}Confirm`)}</p>
            <div className="sess-rename-actions">
              <button type="button" className="sess-rename-btn" onClick={() => setConfirming(null)}>{t('common.cancel')}</button>
              <button type="button" className="sess-rename-btn danger" onClick={confirmAction} autoFocus>{t(`sessionSelect.${confirming}`)}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
