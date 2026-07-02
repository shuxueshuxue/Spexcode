import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { loadIssues, postIssueReply, postIssueThread } from './data.js'
import EvalsGroup, { entryKey } from './EvalsFeed.jsx'
import Annotator from './Annotator.jsx'
import { SpecBody } from './NodeView.jsx'
import { useT } from './i18n/index.jsx'

// The issues page ([[issues-view]]): MASTER-DETAIL over one full routed page. The LEFT column is one
// scrolling list in two groups — the evals feed ([[evals-feed]]) leading, the merged issue list below
// (local forum + forge, store-tagged, API order, no re-sort/no ranking; CONCLUDED issues hidden behind a
// count chip). The RIGHT pane is the full-height DETAIL of the selection — selection IS the detail, no
// in-place expansion in a small box: an issue renders its markdown body (SpecBody — the spec dialect),
// replies, and the local reply composer; an eval renders as the [[annotator]]. j/k walk the whole left
// list across both groups, the detail follows; the write paths are unchanged (reply/propose as 'human',
// forge read-only with a permalink).
export default function IssuesView({ onFocusNode, specs = [] }) {
  const t = useT()
  const [data, setData] = useState(null)          // null = still loading
  const [composing, setComposing] = useState(false)
  const [showConcluded, setShowConcluded] = useState(false)
  const [notice, setNotice] = useState('')
  const [sel, setSel] = useState(null)            // the ONE selection: 'eval:<node>·<scenario>' | 'issue:<id>'
  const [evalRows, setEvalRows] = useState([])    // the evals group's visible entries (its filters are its own)
  const rowsRef = useRef([])                      // flat key list across BOTH groups, for j/k

  const load = useCallback(async () => {
    const d = await loadIssues().catch(() => null)
    setData(d && typeof d === 'object' ? d : { enabled: false, issues: [] })
  }, [])
  useEffect(() => { load() }, [load])

  const flash = (outcomes) => { if (outcomes) { setNotice(outcomes); setTimeout(() => setNotice(''), 6000) } }

  const all = Array.isArray(data?.issues) ? data.issues : []
  // a CONCLUDED issue (forge closed; local rejected/landed) hides by default — the list is the open work,
  // not the archive. open + accepted stay (accepted is approved-but-not-landed: still live).
  const concluded = (i) => i.status === 'closed' || i.status === 'rejected' || i.status === 'landed'
  const issues = showConcluded ? all : all.filter((i) => !concluded(i))
  const openCount = all.filter((i) => i.status === 'open').length
  const concludedCount = all.filter(concluded).length

  const evalByKey = useMemo(() => new Map(evalRows.map((e) => [entryKey(e), e])), [evalRows])
  const issueByKey = useMemo(() => new Map(issues.map((i) => [`issue:${i.id}`, i])), [issues])
  rowsRef.current = [...evalRows.map(entryKey), ...issues.map((i) => `issue:${i.id}`)]
  // default selection: the freshest eval, else the first issue — the detail pane is never idle by default.
  const effSel = sel && (evalByKey.has(sel) || issueByKey.has(sel)) ? sel : rowsRef.current[0] ?? null

  const onRows = useCallback((rows) => setEvalRows(rows), [])

  // page keys ([[issues-view]]): j/k walk the ONE flat list across both groups; the detail follows the
  // selection (no Enter needed — selection IS detail). Capture phase; a key typed into an input/textarea
  // or carrying a modifier is never ours.
  const stateRef = useRef({})
  stateRef.current = { effSel }
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'j' && e.key !== 'k') return
      e.preventDefault(); e.stopPropagation()
      const rows = rowsRef.current
      if (!rows.length) return
      const cur = rows.indexOf(stateRef.current.effSel)
      const next = cur < 0 ? (e.key === 'j' ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, cur + (e.key === 'j' ? 1 : -1)))
      setSel(rows[next])
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  useEffect(() => {
    document.querySelector('.fv-list-col .sel')?.scrollIntoView({ block: 'nearest' })
  }, [effSel])

  if (data == null) return <div className="fv-note">{t('session.issuesLoading')}</div>
  if (!data.enabled) return <div className="fv-note">{t('session.issuesOff')}</div>

  const selEval = effSel ? evalByKey.get(effSel) : null
  const selIssue = effSel ? issueByKey.get(effSel) : null

  return (
    <div className="fv-master">
      <div className="fv-list-col">
        {notice && <div className="fv-notice">{notice}</div>}
        <EvalsGroup nodes={specs} sel={effSel} onSel={(k) => setSel(k)} onRows={onRows} />
        <section className="fv-group">
          <header className="fv-group-head">
            <span className="fv-group-title">{t('session.issuesThreadsTitle')}</span>
            <span className="fv-group-meta">{t('session.issuesThreadsSummary', { open: openCount, total: all.length })}</span>
            <span className="ef-chipbar">
              <button type="button" className="fv-new-btn" onClick={() => setComposing((v) => !v)}>
                {composing ? t('session.issuesCancel') : t('session.issuesNew')}
              </button>
              {concludedCount > 0 && (
                <button type="button" className={`ef-chip fv-concluded ${showConcluded ? 'on' : ''}`} onClick={() => setShowConcluded((v) => !v)}>
                  {t('nodeView.closedIssues', { n: concludedCount })}
                </button>
              )}
            </span>
          </header>
          {composing && <NewThreadForm onDone={async (outcomes) => { setComposing(false); flash(outcomes); await load() }} />}
          {!issues.length && <div className="fv-note">{t('session.issuesEmpty')}</div>}
          {issues.map((th) => {
            const k = `issue:${th.id}`
            return (
              <button key={th.id} className={`fv-row ${effSel === k ? 'sel' : ''}`} onClick={() => setSel(k)}>
                <span className={`fv-store fv-store-${th.store === 'local' ? 'local' : 'forge'}`}>{th.store}</span>
                <span className="fv-concern">{th.concern}</span>
                {th.status && <span className={`fv-status fv-st-${th.status}`}>{th.status}</span>}
                {th.store === 'local' && (th.replies?.length ?? 0) > 0 && <span className="fv-count">{t('session.issuesReplies', { n: th.replies.length })}</span>}
              </button>
            )
          })}
        </section>
      </div>
      <div className="fv-detail">
        {selEval && <Annotator entry={selEval} onFiled={load} />}
        {selIssue && <IssueDetail issue={selIssue} onFocusNode={onFocusNode} onWrite={async (outcomes) => { flash(outcomes); await load() }} />}
        {!selEval && !selIssue && <div className="fv-note">{t('session.issuesEmpty')}</div>}
      </div>
    </div>
  )
}

// the issue detail — full-height: header (store/status/author/node chips/permalink), the markdown-RENDERED
// body, the reply thread, and the local composer (forge: read here, discussed there).
function IssueDetail({ issue: th, onFocusNode, onWrite }) {
  const t = useT()
  const local = th.store === 'local'
  const nodes = Array.isArray(th.nodes) ? th.nodes : []
  const signers = Array.isArray(th.signers) ? th.signers : []
  const replies = Array.isArray(th.replies) ? th.replies : []
  return (
    <div className="fvd">
      <header className="fvd-head">
        <span className={`fv-store fv-store-${local ? 'local' : 'forge'}`}>{th.store}</span>
        <span className="fvd-concern">{th.concern}</span>
      </header>
      <div className="fvd-meta">
        {th.status && <span className={`fv-status fv-st-${th.status}`}>{th.status}</span>}
        {th.by && <span className="fv-by">{th.by}</span>}
        {local && <span className="fv-count">{t('session.issuesSigned', { n: signers.length })}</span>}
        {nodes.map((id) => (
          <button key={id} type="button" className="fv-chip" onClick={() => onFocusNode?.(id)} title={t('session.issuesFocusNode')}>{id}</button>
        ))}
        {th.url && <a className="fv-link" href={th.url} target="_blank" rel="noreferrer">{t('session.issuesOpenOnForge')}</a>}
      </div>
      {th.body && <div className="fvd-body"><SpecBody body={th.body} /></div>}
      {replies.map((r, i) => (
        <div className="fv-reply" key={i}>
          <div className="fv-reply-meta">
            <span className="fv-reply-by">{r.by}</span>
            {r.at && <span className="fv-reply-at">{r.at}</span>}
          </div>
          <div className="fvd-body"><SpecBody body={r.body} /></div>
        </div>
      ))}
      {local
        ? <ReplyComposer id={th.id} onDone={onWrite} />
        : <div className="fv-hint">{t('session.issuesForgeReadOnly')}</div>}
    </div>
  )
}

// a small textarea + Send under a LOCAL issue's detail — posts a reply as 'human' and reloads. An
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
        disabled={busy} onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }} />
      <div className="fv-actions">
        <span className="fv-hint">{t('session.issuesMentionHint')}</span>
        <button type="button" className="fv-send" disabled={busy || !concern.trim()} onClick={submit}>
          {busy ? t('session.issuesSending') : t('session.issuesPost')}
        </button>
      </div>
    </div>
  )
}
