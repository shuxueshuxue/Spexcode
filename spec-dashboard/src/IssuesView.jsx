import { useEffect, useState, useCallback, useRef } from 'react'
import { loadIssues, postIssueReply, postIssueThread } from './data.js'
import FeedSection from './FeedSection.jsx'
import EvalsSection from './EvalsFeed.jsx'
import { useT } from './i18n/index.jsx'

// The issues page ([[issues-view]]): ONE merged list over every store ([[issues]]) — local forum threads
// and forge issues mixed, store-tagged — a thin window over `GET /api/issues` (`{ enabled, issues }`). It
// renders issues in the EXACT order the API returns — no re-sort, no salience/priority ranking (recurrence
// is the CLI drain's judgment); signer/reply counts show as raw data. Store never changes the shape, only
// two affordances: a LOCAL issue expands to its body + replies and takes a human reply (POSTed through the
// SAME reply/propose the CLI uses, author 'human'; an @-mention dispatches a worker and the outcome is
// echoed); a FORGE issue carries its permalink — read here, discussed there. `onFocusNode(id)` closes the
// console and focuses that node on the board.
export default function IssuesView({ onFocusNode, specs = [] }) {
  const t = useT()
  const [data, setData] = useState(null)          // null = still loading
  const [expanded, setExpanded] = useState(() => new Set())
  const [composing, setComposing] = useState(false)  // the "New" thread form is open
  const [showConcluded, setShowConcluded] = useState(false) // concluded issues (closed/rejected/landed) hide by default
  const [notice, setNotice] = useState('')           // a brief @-dispatch summary after a write
  const [selIdx, setSelIdx] = useState(-1)           // the j/k-walked row; -1 = none
  const rowsRef = useRef([])                         // current issue ids, for the key handler
  const [region, setRegion] = useState('threads')    // Tab-focused region: 'evals' ⇄ 'threads'
  const regionRef = useRef(region); regionRef.current = region

  const load = useCallback(async () => {
    const d = await loadIssues().catch(() => null)
    setData(d && typeof d === 'object' ? d : { enabled: false, issues: [] })
  }, [])

  useEffect(() => {
    let alive = true
    loadIssues().then((d) => { if (alive) setData(d && typeof d === 'object' ? d : { enabled: false, issues: [] }) })
      .catch(() => { if (alive) setData(null) })
    return () => { alive = false }
  }, [])

  // echo the @-dispatch summary briefly (outcomes is '' when nothing was summoned).
  const flash = (outcomes) => { if (outcomes) { setNotice(outcomes); setTimeout(() => setNotice(''), 6000) } }

  // stable (declared before the key effect below, which closes over it once).
  const toggle = useCallback((id) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    }), [])

  // panel keys ([[issues-view]]): Tab jumps between the two regions (evals ⇄ threads — focus shown on the
  // section head); j/k walk the FOCUSED region's rows, Enter opens the selected row. The threads rows are
  // this component's; the evals region's row-nav is [[evals-feed]]'s own (until it lands, j/k are inert
  // while evals hold focus). Capture phase so a stray console handler never eats them; a key typed into an
  // input/textarea (the composers) or carrying a modifier is never ours.
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation()
        setRegion((r) => (r === 'threads' ? 'evals' : 'threads'))
        return
      }
      if (regionRef.current !== 'threads') return
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault(); e.stopPropagation()
        const n = rowsRef.current.length
        if (!n) return
        setSelIdx((i) => {
          const start = i < 0 ? (e.key === 'j' ? -1 : n) : i
          return Math.max(0, Math.min(n - 1, start + (e.key === 'j' ? 1 : -1)))
        })
      } else if (e.key === 'Enter') {
        setSelIdx((i) => {
          const id = rowsRef.current[i]
          if (id) { e.preventDefault(); e.stopPropagation(); toggle(id) }
          return i
        })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // keep the selected row in view as j/k walk it (the section body is the scroller, never the panel).
  useEffect(() => {
    if (selIdx >= 0) document.querySelector('.fv-thread.kbd-sel')?.scrollIntoView({ block: 'nearest' })
  }, [selIdx])

  if (data == null || !data.enabled) rowsRef.current = []   // no rows on screen → no rows for j/k
  if (data == null) return <div className="fv-note">{t('session.issuesLoading')}</div>
  // honors the switch: forum workflow OFF → a muted state, never a forked source of truth.
  if (!data.enabled) return <div className="fv-note">{t('session.issuesOff')}</div>
  const all = Array.isArray(data.issues) ? data.issues : []
  // a CONCLUDED issue (forge closed; local rejected/landed) hides by default — the list is the open work,
  // not the archive; a count chip reveals the concluded set on demand. open + accepted stay visible
  // (accepted is approved-but-not-landed: still live).
  const concluded = (i) => i.status === 'closed' || i.status === 'rejected' || i.status === 'landed'
  const issues = showConcluded ? all : all.filter((i) => !concluded(i))
  rowsRef.current = issues.map((i) => i.id)
  const openCount = all.filter((i) => i.status === 'open').length
  const concludedCount = all.filter(concluded).length

  return (
    <div className="fv-panel">
      {notice && <div className="fv-notice">{notice}</div>}
      {/* the evals region ([[evals-feed]]) leads ABOVE the threads — evals outrank issues here; it wraps
          itself in its own FeedSection so its counts stay internal. Tab moves the panel focus between it
          and the threads. */}
      <EvalsSection nodes={specs} focused={region === 'evals'} />
      {/* the threads region — one FeedSection instance ([[issues-view]]'s panel furniture). */}
      <FeedSection title={t('session.issuesThreadsTitle')} summary={t('session.issuesThreadsSummary', { open: openCount, total: all.length })} density="region" focused={region === 'threads'}>
      <div className="fv-toolbar">
        <button type="button" className="fv-new-btn" onClick={() => setComposing((v) => !v)}>
          {composing ? t('session.issuesCancel') : t('session.issuesNew')}
        </button>
        <span className="fv-hint">{t('session.issuesMentionHint')}</span>
        {concludedCount > 0 && (
          <button type="button" className={`ef-chip fv-concluded ${showConcluded ? 'on' : ''}`} onClick={() => setShowConcluded((v) => !v)}>
            {t('nodeView.closedIssues', { n: concludedCount })}
          </button>
        )}
      </div>
      {composing && (
        <NewThreadForm
          onDone={async (outcomes) => { setComposing(false); flash(outcomes); await load() }}
        />
      )}
      {!issues.length ? (
        <div className="fv-note">{t('session.issuesEmpty')}</div>
      ) : (
        <div className="fv-list">
          {issues.map((th, idx) => {
            const local = th.store === 'local'
            const open = expanded.has(th.id)
            const nodes = Array.isArray(th.nodes) ? th.nodes : []
            const signers = Array.isArray(th.signers) ? th.signers : []
            const replies = Array.isArray(th.replies) ? th.replies : []
            return (
              <div key={th.id} className={`fv-thread${open ? ' open' : ''}${idx === selIdx ? ' kbd-sel' : ''}`}>
                {/* the whole header toggles the in-place expansion; node chips / the forge permalink inside
                    stop propagation so their click acts instead of expanding. */}
                <div className="fv-head" role="button" tabIndex={0} onClick={() => toggle(th.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(th.id) } }}>
                  <span className={`fv-store fv-store-${local ? 'local' : 'forge'}`}>{th.store}</span>
                  <span className="fv-concern">{th.concern}</span>
                  {th.status && <span className={`fv-status fv-st-${th.status}`}>{th.status}</span>}
                  {th.by && <span className="fv-by">{th.by}</span>}
                  {nodes.length > 0 && (
                    <span className="fv-chips">
                      {nodes.map((id) => (
                        <button key={id} type="button" className="fv-chip"
                          onClick={(e) => { e.stopPropagation(); onFocusNode?.(id) }}
                          title={t('session.issuesFocusNode')}>{id}</button>
                      ))}
                    </span>
                  )}
                  <span className="fv-counts">
                    {local && <span className="fv-count">{t('session.issuesSigned', { n: signers.length })}</span>}
                    {local && <span className="fv-count">{t('session.issuesReplies', { n: replies.length })}</span>}
                    {th.url && (
                      <a className="fv-link" href={th.url} target="_blank" rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}>{t('session.issuesOpenOnForge')}</a>
                    )}
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
                    {local
                      ? <ReplyComposer id={th.id} onDone={async (outcomes) => { flash(outcomes); await load() }} />
                      : <div className="fv-hint">{t('session.issuesForgeReadOnly')}</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      </FeedSection>
    </div>
  )
}

// a small textarea + Send in an expanded LOCAL issue — posts a reply as 'human' and reloads. An
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
      const res = await postIssueReply(id, text)
      if (res?.ok) { setBody(''); await onDone?.(res.outcomes || '') }
    } finally { setBusy(false) }
  }
  return (
    <div className="fv-compose">
      <textarea className="fv-textarea" rows={2} value={body} placeholder={t('session.issuesReplyPlaceholder')}
        disabled={busy} onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }} />
      <div className="fv-actions">
        <span className="fv-hint">{t('session.issuesMentionHint')}</span>
        <button type="button" className="fv-send" disabled={busy || !body.trim()} onClick={send}>
          {busy ? t('session.issuesSending') : t('session.issuesSend')}
        </button>
      </div>
    </div>
  )
}

// the "New" affordance — a concern line, an optional node-ids field, and a body. Posts a fresh LOCAL
// issue as 'human' (v1 writes are local-only — the forge stays read-only); an @-mention in the body dispatches.
function NewThreadForm({ onDone }) {
  const t = useT()
  const [concern, setConcern] = useState('')
  const [nodes, setNodes] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    const c = concern.trim()
    if (!c || busy) return
    setBusy(true)
    try {
      const nodeList = nodes.split(',').map((s) => s.trim()).filter(Boolean)
      const res = await postIssueThread({ concern: c, nodes: nodeList, body: body.trim() || undefined })
      if (res?.ok) { setConcern(''); setNodes(''); setBody(''); await onDone?.(res.outcomes || '') }
    } finally { setBusy(false) }
  }
  return (
    <div className="fv-new-form">
      <input className="fv-input" value={concern} placeholder={t('session.issuesConcernPlaceholder')}
        disabled={busy} onChange={(e) => setConcern(e.target.value)} />
      <input className="fv-input" value={nodes} placeholder={t('session.issuesNodesPlaceholder')}
        disabled={busy} onChange={(e) => setNodes(e.target.value)} />
      <textarea className="fv-textarea" rows={3} value={body} placeholder={t('session.issuesBodyPlaceholder')}
        disabled={busy} onChange={(e) => setBody(e.target.value)} />
      <div className="fv-actions">
        <span className="fv-hint">{t('session.issuesMentionHint')}</span>
        <button type="button" className="fv-send" disabled={busy || !concern.trim()} onClick={submit}>
          {busy ? t('session.issuesSending') : t('session.issuesPost')}
        </button>
      </div>
    </div>
  )
}
