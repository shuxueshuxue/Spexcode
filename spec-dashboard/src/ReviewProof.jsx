import { useEffect, useState } from 'react'
import { useT } from './i18n/index.jsx'

// The review-proof rendered INLINE as the session console's Proof tab ([[review-proof]] · [[session-console]]).
// Promoted from a review-only floating overlay to an ALWAYS-available pane: any selected session can open it,
// not only one in review. The proof is a fully self-contained HTML document (evidence inlined as data-URIs),
// so we fetch it ONCE and mount it via `srcDoc` — no second request. The ok-check drives a clean placeholder
// when a session has no proof to show yet (no worktree/diff → the route 404s). Because the proof is DERIVED —
// generated on the fly from the live diff/loss/gates — remounting on each visit always reflects current truth.
export function ProofPane({ sessionId }) {
  const t = useT()
  const url = `/api/sessions/${encodeURIComponent(sessionId)}/proof`
  const [state, setState] = useState({ status: 'loading', html: '' })
  useEffect(() => {
    let alive = true
    setState({ status: 'loading', html: '' })
    fetch(url)
      .then(async (r) => {
        if (!alive) return
        if (!r.ok) { setState({ status: 'empty', html: '' }); return }
        const html = await r.text()
        if (alive) setState({ status: 'ready', html })
      })
      .catch(() => { if (alive) setState({ status: 'empty', html: '' }) })
    return () => { alive = false }
  }, [url])
  return (
    <div className="proof-pane">
      <div className="proof-bar">
        <span className="proof-title">{t('proof.title')}</span>
        {state.status === 'ready' && (
          <a className="proof-newtab" href={url} target="_blank" rel="noopener noreferrer">{t('proof.newTab')} ↗</a>
        )}
      </div>
      {state.status === 'ready' && (
        <iframe className="proof-iframe" srcDoc={state.html} title={t('proof.title')} />
      )}
      {state.status === 'loading' && <div className="proof-empty proof-loading">{t('proof.loading')}</div>}
      {state.status === 'empty' && (
        <div className="proof-empty">
          <div className="proof-empty-msg">{t('proof.emptyMsg')}</div>
          <div className="proof-empty-sub">{t('proof.emptySub')}</div>
        </div>
      )}
    </div>
  )
}
