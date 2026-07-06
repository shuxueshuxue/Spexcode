import { useState } from 'react'
import Modal from './Modal.jsx'
import { apiFetch } from './data.js'
import { useEscLayer } from './escStack.js'
import { useT } from './i18n/index.jsx'

// The multi-select mode's top bar ([[session-multi-select]]): a live pick count + a destructive bulk delete +
// a cancel. It owns the delete-confirm modal and the bulk close, but NOT the picking itself — which rows are
// ticked lives in the list ([[session-console]]); this bar only reads the count and acts on the ids.
export default function SessionSelectBar({ ids, onCancel, onDeleted }) {
  const t = useT()
  const [confirming, setConfirming] = useState(false)
  const count = ids.length

  useEscLayer(confirming, () => setConfirming(false))

  // confirmed bulk delete: dismiss the confirm AT ONCE and fire every close in the BACKGROUND (the same
  // fire-and-forget the single close uses — the human must never watch N worktree removals in a frozen
  // dialog). Leave select mode + reload when they all settle; a failed close is reconciled by the next poll.
  const confirmDelete = () => {
    setConfirming(false)
    Promise.all(ids.map((id) =>
      apiFetch(`/api/sessions/${id}/close`, { method: 'POST' }).catch(() => { /* next board poll reconciles */ })
    )).finally(() => onDeleted?.())
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
        >{t('sessionSelect.delete')}</button>
        <button type="button" className="sess-rename-btn" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
      {confirming && (
        <Modal
          title={t('sessionSelect.deleteTitle', { n: count })}
          closeLabel={t('common.close')}
          className="sess-rename-modal"
          onClose={() => setConfirming(false)}
        >
          <div className="sess-confirm">
            <p className="sess-confirm-msg">{t('sessionSelect.deleteConfirm')}</p>
            <div className="sess-rename-actions">
              <button type="button" className="sess-rename-btn" onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
              <button type="button" className="sess-rename-btn danger" onClick={confirmDelete}>{t('sessionSelect.delete')}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
