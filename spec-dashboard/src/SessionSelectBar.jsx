import { useState } from 'react'
import Modal from './Modal.jsx'
import { apiFetch } from './data.js'
import { useEscLayer } from './escStack.js'
import { useT } from './i18n/index.jsx'

// The multi-select mode's top bar ([[session-multi-select]]): a live pick count + a destructive bulk CLOSE +
// a cancel. The verb is `close` — the same one the single-row menu uses ([[session-rename]]), not a third
// "delete" word — because each pick fires that exact close endpoint. It owns the close-confirm modal and the
// bulk fan-out, but NOT the picking itself — which rows are ticked lives in the list ([[session-console]]);
// this bar only reads the count and acts on the ids.
export default function SessionSelectBar({ ids, onCancel, onClosed, onError }) {
  const t = useT()
  const [confirming, setConfirming] = useState(false)
  const count = ids.length

  useEscLayer(confirming, () => setConfirming(false))

  // confirmed bulk close: dismiss the confirm AT ONCE and fire every close in the BACKGROUND (the same
  // fire-and-forget the single close uses — the human must never watch N worktree removals in a frozen
  // dialog). Leave select mode + reload when they all settle; the same failure text as single close reaches the
  // panel outcome instead of leaving HTTP 409 as a console-only clue.
  const confirmClose = () => {
    setConfirming(false)
    Promise.all(ids.map(async (id) => {
      try {
        const response = await apiFetch(`/api/sessions/${id}/close`, { method: 'POST' })
        const body = await response.json().catch(() => null)
        return !response.ok || body?.ok === false ? body?.error || `session close refused (HTTP ${response.status})` : null
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
        <button
          type="button"
          className="sess-rename-btn danger"
          disabled={count === 0}
          onClick={() => setConfirming(true)}
        >{t('sessionSelect.close')}</button>
        <button type="button" className="sess-rename-btn" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
      {confirming && (
        <Modal
          data-tip={t('sessionSelect.closeTitle', { n: count })}
          closeLabel={t('common.close')}
          className="sess-rename-modal"
          onClose={() => setConfirming(false)}
        >
          <div className="sess-confirm">
            <p className="sess-confirm-msg">{t('sessionSelect.closeConfirm')}</p>
            <div className="sess-rename-actions">
              <button type="button" className="sess-rename-btn" onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
              <button type="button" className="sess-rename-btn danger" onClick={confirmClose}>{t('sessionSelect.close')}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
