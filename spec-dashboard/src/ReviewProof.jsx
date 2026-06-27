import { useT } from './i18n/index.jsx'
import { useEscLayer } from './escStack.js'

// @@@ ReviewProof - the dashboard's thin face on the [[review-proof]] engine. The `proof` board command
// (and its header button, see [[session-console]]'s command registry) opens a review/done session's PROOF
// OF WORK — the backend-rendered, self-contained HTML at /api/sessions/:id/proof — inside an overlay iframe.
// This is deliberately thin: the dashboard renders NOTHING of the proof itself, it just opens the route (the
// SAME bytes `spex review proof` writes and a bare browser shows). The open/close STATE is owned by
// SessionInterface so the typed `/proof` command and the header button drive the one same overlay; this
// component is just the overlay. "Natural support" = a browser renders the artifact; the dashboard frames it.

export function ProofOverlay({ sessionId, onClose }) {
  const t = useT()
  const url = `/api/sessions/${encodeURIComponent(sessionId)}/proof`
  // Esc closes ONLY this overlay: it is the top [[esc-layers]] layer while open, so a press peels it and the
  // session board behind it stays. The ✕ and a backdrop click also close. The proof renders in an iframe that
  // STEALS keyboard focus on load, so the parent window (where the stack listens) never sees its keydowns —
  // attach a closer to the iframe's own window too (it is same-origin, served by /api).
  useEscLayer(true, onClose)
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
          <span className="proof-title">{t('proof.title')}</span>
          <a className="proof-newtab" href={url} target="_blank" rel="noopener noreferrer">{t('proof.newTab')} ↗</a>
          <button className="proof-x" onClick={onClose} title={t('proof.close')}>✕</button>
        </div>
        <iframe className="proof-iframe" src={url} title={t('proof.title')} ref={wireFrame} />
      </div>
    </div>
  )
}
