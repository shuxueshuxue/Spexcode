import { useEffect, useState } from 'react'
import { loadForum } from './data.js'
import { useT } from './i18n/index.jsx'

// The read-only forum info page ([[forum-view]]): a THIN window over `GET /api/forum` (`{ enabled, threads }`).
// It renders threads in the EXACT order the API returns — no re-sort, no salience/priority ranking (recurrence
// is the CLI drain's judgment, never an automatic order); signer/reply counts show as raw data, not a rank.
// Writes stay in the CLI, so this view neither posts nor replies. `onFocusNode(id)` closes the console and
// focuses that node on the board, keeping the forum anchored to the graph it discusses.
export default function ForumView({ onFocusNode }) {
  const t = useT()
  const [data, setData] = useState(null)          // null = still loading
  const [expanded, setExpanded] = useState(() => new Set())

  useEffect(() => {
    let alive = true
    const done = (d) => { if (alive) setData(d && typeof d === 'object' ? d : { enabled: false, threads: [] }) }
    loadForum().then(done).catch(() => done(null))
    return () => { alive = false }
  }, [])

  if (data == null) return <div className="fv-note">{t('session.forumLoading')}</div>
  // honors the switch: forum OFF → a muted state, never a forked source of truth.
  if (!data.enabled) return <div className="fv-note">{t('session.forumOff')}</div>
  const threads = Array.isArray(data.threads) ? data.threads : []
  if (!threads.length) return <div className="fv-note">{t('session.forumEmpty')}</div>

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  return (
    <div className="fv-list">
      {threads.map((th) => {
        const open = expanded.has(th.id)
        const nodes = Array.isArray(th.nodes) ? th.nodes : []
        const signers = Array.isArray(th.signers) ? th.signers : []
        const replies = Array.isArray(th.replies) ? th.replies : []
        return (
          <div key={th.id} className={open ? 'fv-thread open' : 'fv-thread'}>
            {/* the whole header toggles the in-place expansion; node chips inside stop propagation so a chip
                click focuses the graph instead of expanding. */}
            <div className="fv-head" role="button" tabIndex={0} onClick={() => toggle(th.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(th.id) } }}>
              <span className={`fv-kind fv-kind-${th.kind}`}>{t(`session.forumKind.${th.kind}`) || th.kind}</span>
              <span className="fv-concern">{th.concern}</span>
              {th.status && <span className={`fv-status fv-st-${th.status}`}>{th.status}</span>}
              {th.by && <span className="fv-by">{th.by}</span>}
              {nodes.length > 0 && (
                <span className="fv-chips">
                  {nodes.map((id) => (
                    <button key={id} type="button" className="fv-chip"
                      onClick={(e) => { e.stopPropagation(); onFocusNode?.(id) }}
                      title={t('session.forumFocusNode')}>{id}</button>
                  ))}
                </span>
              )}
              <span className="fv-counts">
                <span className="fv-count">{t('session.forumSigned', { n: signers.length })}</span>
                <span className="fv-count">{t('session.forumReplies', { n: replies.length })}</span>
              </span>
            </div>
            {open && (
              <div className="fv-body">
                {th.body && <div className="fv-text">{th.body}</div>}
                {replies.map((r, i) => (
                  <div className="fv-reply" key={i}>
                    <div className="fv-reply-meta">
                      <span className="fv-reply-by">{r.by}</span>
                      {r.at && <span className="fv-reply-at">{r.at}</span>}
                    </div>
                    <div className="fv-text">{r.body}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
