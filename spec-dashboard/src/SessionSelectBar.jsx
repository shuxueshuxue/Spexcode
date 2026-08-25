import { useState } from 'react'
import Modal from './Modal.jsx'
import { apiFetch } from './data.js'
import { useEscLayer } from './escStack.js'
import { IconButton } from './icons.jsx'
import { useT } from './i18n/index.jsx'

// Selection owns only the set of rows and the one bulk verb. Lifecycle semantics remain the same close
// endpoint used by the single-row menu; this bar never invents a second delete operation.
export default function SessionSelectBar({ ids, onCancel, onClosed, onError }) {
  const t = useT()
  const [confirming, setConfirming] = useState(false)
  useEscLayer(confirming, () => setConfirming(false))
  const confirmClose = () => {
    setConfirming(false)
    Promise.all(ids.map((id) => apiFetch(`/api/sessions/${id}/close`, { method: 'POST' }).then(async (response) => {
      if (response.ok) return
      const body = await response.json().catch(() => null)
      throw new Error(body?.error || `session close refused (HTTP ${response.status})`)
    }))).then(() => onClosed?.()).catch((error) => {
      onError?.(error instanceof Error ? error.message : String(error))
      onClosed?.()
    })
  }
  return <>
    <div className="si-selbar">
      <span className="si-selcount">{t('sessionSelect.selected', { n: ids.length })}</span>
      <IconButton icon="trash" size={14} className="si-selaction danger" label={t('sessionSelect.close')}
        disabled={!ids.length} onClick={() => setConfirming(true)} />
      <IconButton icon="x" size={14} className="si-selaction" label={t('common.cancel')} onClick={onCancel} />
    </div>
    {confirming && <Modal title={t('sessionSelect.closeTitle', { n: ids.length })} closeLabel={t('common.close')} className="sess-rename-modal" onClose={() => setConfirming(false)}>
      <div className="sess-confirm">
        <p className="sess-confirm-msg">{t('sessionSelect.closeConfirm')}</p>
        <div className="sess-rename-actions">
          <button type="button" className="sess-rename-btn" onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
          <button type="button" className="sess-rename-btn danger" onClick={confirmClose}>{t('sessionSelect.close')}</button>
        </div>
      </div>
    </Modal>}
  </>
}
