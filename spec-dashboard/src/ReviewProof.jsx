import { useEffect, useState } from 'react'
import { useT } from './i18n/index.jsx'

// @@@ ReviewProof - the dashboard's thin face on the [[review-proof]] engine. A `proof` action, shown on a
// session in the review/done state, opens that session's PROOF OF WORK — the backend-rendered, self-contained
// HTML at /api/sessions/:id/proof — inside an overlay iframe. This is deliberately thin: the dashboard renders
// NOTHING of the proof itself, it just opens the route (the SAME bytes `spex review proof` writes and a bare
// browser shows). "Natural support" = a browser renders the artifact; the dashboard only frames it.

export function ProofButton({ sessionId, status }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  if (status !== 'review' && status !== 'done') return null
  return (
    <>
      <button className="si-act proof" title={t('proof.btnTitle')} onClick={() => setOpen(true)}>◆ {t('proof.btn')}</button>
      {open && <ProofOverlay sessionId={sessionId} onClose={() => setOpen(false)} />}
    </>
  )
}

function ProofOverlay({ sessionId, onClose }) {
  const t = useT()
  const url = `/api/sessions/${encodeURIComponent(sessionId)}/proof`
  // Esc closes ONLY the overlay: capture + stopImmediatePropagation so it wins over the interface's own Esc
  // (which would otherwise close the whole session board behind it). The ✕ and a backdrop click also close.
  // The proof renders in an iframe that STEALS keyboard focus on load, so the parent window never sees its
  // keydowns — attach the same handler to the iframe's own window too (it is same-origin, served by /api).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  const wireFrame = (frame) => {
    if (!frame) return
    frame.addEventListener('load', () => {
      try { frame.contentWindow?.addEventListener('keydown', (e) => { if (e.key === 'Escape') onClose() }) } catch { /* cross-origin: rely on ✕ / backdrop */ }
    })
  }
  return (
    <div className="proof-overlay" onClick={onClose}>
      <div className="proof-frame" onClick={(e) => e.stopPropagation()}>
        <div className="proof-bar">
          <span className="proof-title">◆ {t('proof.title')}</span>
          <a className="proof-newtab" href={url} target="_blank" rel="noopener noreferrer">{t('proof.newTab')} ↗</a>
          <button className="proof-x" onClick={onClose} title={t('proof.close')}>✕</button>
        </div>
        <iframe className="proof-iframe" src={url} title={t('proof.title')} ref={wireFrame} />
      </div>
    </div>
  )
}
