import { useEffect, useState, useCallback } from 'react'
import { loadForum, postForumReply, postForumThread } from './data.js'
import { useT } from './i18n/index.jsx'

// The forum info page ([[forum-view]]): a thin window over `GET /api/forum` (`{ enabled, threads }`) that is
// now also WRITABLE by a human. It renders threads in the EXACT order the API returns — no re-sort, no
// salience/priority ranking (recurrence is the CLI drain's judgment); signer/reply counts show as raw data.
// The write path (a reply composer in each expanded thread + a "New" affordance for a fresh proposal/note)
// POSTs through the SAME reply/propose the CLI uses (git-committed to the trunk, author 'human'); a human
// @-mention dispatches a worker (the point — humans summon agents from the forum), and the dispatch outcome
// is echoed. `onFocusNode(id)` closes the console and focuses that node on the board.
export default function ForumView({ onFocusNode }) {
  const t = useT()
  const [data, setData] = useState(null)          // null = still loading
  const [expanded, setExpanded] = useState(() => new Set())
  const [composing, setComposing] = useState(false)  // the "New" thread form is open
  const [notice, setNotice] = useState('')           // a brief @-dispatch summary after a write

  const load = useCallback(async () => {
    const d = await loadForum().catch(() => null)
    setData(d && typeof d === 'object' ? d : { enabled: false, threads: [] })
  }, [])

  useEffect(() => {
    let alive = true
    loadForum().then((d) => { if (alive) setData(d && typeof d === 'object' ? d : { enabled: false, threads: [] }) })
      .catch(() => { if (alive) setData(null) })
    return () => { alive = false }
  }, [])

  // echo the @-dispatch summary briefly (outcomes is '' when nothing was summoned).
  const flash = (outcomes) => { if (outcomes) { setNotice(outcomes); setTimeout(() => setNotice(''), 6000) } }

  if (data == null) return <div className="fv-note">{t('session.forumLoading')}</div>
  // honors the switch: forum OFF → a muted state, never a forked source of truth.
  if (!data.enabled) return <div className="fv-note">{t('session.forumOff')}</div>
  const threads = Array.isArray(data.threads) ? data.threads : []

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  return (
    <div className="fv-wrap">
      {notice && <div className="fv-notice">{notice}</div>}
      <div className="fv-toolbar">
        <button type="button" className="fv-new-btn" onClick={() => setComposing((v) => !v)}>
          {composing ? t('session.forumCancel') : t('session.forumNew')}
        </button>
        <span className="fv-hint">{t('session.forumMentionHint')}</span>
      </div>
      {composing && (
        <NewThreadForm
          onDone={async (outcomes) => { setComposing(false); flash(outcomes); await load() }}
        />
      )}
      {!threads.length ? (
        <div className="fv-note">{t('session.forumEmpty')}</div>
      ) : (
        <div className="fv-list">
          {threads.map((th) => {
            const open = expanded.has(th.id)
            const nodes = Array.isArray(th.nodes) ? th.nodes : []
            const signers = Array.isArray(th.signers) ? th.signers : []
            const replies = Array.isArray(th.replies) ? th.replies : []
            return (
              <div key={th.id} className={open ? 'fv-thread open' : 'fv-thread'}>
                {/* the whole header toggles the in-place expansion; node chips inside stop propagation so a
                    chip click focuses the graph instead of expanding. */}
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
                    <ReplyComposer id={th.id} onDone={async (outcomes) => { flash(outcomes); await load() }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// a small textarea + Send in an expanded thread — posts a reply as 'human' and reloads the forum. An
// @-mention in the text summons a worker; the returned outcomes string surfaces via onDone.
function ReplyComposer({ id, onDone }) {
  const t = useT()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    const text = body.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const res = await postForumReply(id, text)
      if (res?.ok) { setBody(''); await onDone?.(res.outcomes || '') }
    } finally { setBusy(false) }
  }
  return (
    <div className="fv-compose">
      <textarea className="fv-textarea" rows={2} value={body} placeholder={t('session.forumReplyPlaceholder')}
        disabled={busy} onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }} />
      <div className="fv-actions">
        <span className="fv-hint">{t('session.forumMentionHint')}</span>
        <button type="button" className="fv-send" disabled={busy || !body.trim()} onClick={send}>
          {busy ? t('session.forumSending') : t('session.forumSend')}
        </button>
      </div>
    </div>
  )
}

// the "New" affordance — a concern line, a proposal/note kind toggle, an optional node-ids field, and a body.
// Posts a fresh thread as 'human'; an @-mention in the body dispatches.
function NewThreadForm({ onDone }) {
  const t = useT()
  const [concern, setConcern] = useState('')
  const [kind, setKind] = useState('proposal')
  const [nodes, setNodes] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    const c = concern.trim()
    if (!c || busy) return
    setBusy(true)
    try {
      const nodeList = nodes.split(',').map((s) => s.trim()).filter(Boolean)
      const res = await postForumThread({ concern: c, kind, nodes: nodeList, body: body.trim() || undefined })
      if (res?.ok) { setConcern(''); setNodes(''); setBody(''); await onDone?.(res.outcomes || '') }
    } finally { setBusy(false) }
  }
  return (
    <div className="fv-new-form">
      <div className="fv-kindtoggle">
        {['proposal', 'note'].map((k) => (
          <button key={k} type="button" className={kind === k ? 'fv-kind-opt on' : 'fv-kind-opt'}
            onClick={() => setKind(k)}>{t(`session.forumKind.${k}`) || k}</button>
        ))}
      </div>
      <input className="fv-input" value={concern} placeholder={t('session.forumConcernPlaceholder')}
        disabled={busy} onChange={(e) => setConcern(e.target.value)} />
      <input className="fv-input" value={nodes} placeholder={t('session.forumNodesPlaceholder')}
        disabled={busy} onChange={(e) => setNodes(e.target.value)} />
      <textarea className="fv-textarea" rows={3} value={body} placeholder={t('session.forumBodyPlaceholder')}
        disabled={busy} onChange={(e) => setBody(e.target.value)} />
      <div className="fv-actions">
        <span className="fv-hint">{t('session.forumMentionHint')}</span>
        <button type="button" className="fv-send" disabled={busy || !concern.trim()} onClick={submit}>
          {busy ? t('session.forumSending') : t('session.forumPost')}
        </button>
      </div>
    </div>
  )
}
