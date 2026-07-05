import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { postIssueReply, postIssueThread } from './data.js'
import { useMentionAutocomplete } from './mentions.jsx'
import { SpecBody } from './NodeView.jsx'
import { Replies, ReplyComposer, OriginatorLiveness } from './Thread.jsx'
import { useT } from './i18n/index.jsx'

// The Issues page ([[issues-view]]): a top-level page (#/issues, [[side-nav]]), peer of the graph, the
// session board, and the Evals page. MASTER-DETAIL over one full routed page — the LEFT column is the
// SLIM merged ISSUE list (local + forge, store-tagged, API order, no re-sort/no ranking; CONCLUDED
// issues hidden behind a count chip) under its own filter bar, foldable to a thin strip so the detail
// owns the width; the RIGHT pane is the full-height DETAIL of the selection — selection IS the detail,
// no in-place expansion in a small box: an issue renders its markdown body (SpecBody — the spec dialect),
// its replies, and the reply composer — BOTH stores ([[issues]]: the reply verb routes by store). j/k
// walk the issue list even while folded, the detail follows; writes post as 'human'. The evals are their
// OWN top-level page now ([[evals-view]]) — no in-page switcher here.
export default function IssuesPage({ onFocusNode, specs = [], sessions = [], issuesData = null, reloadIssues }) {
  const t = useT()
  const data = issuesData                          // RESIDENT app state — the page renders instantly, no per-mount fetch
  const [composing, setComposing] = useState(false)
  const [folded, setFolded] = useState(false)      // the master list folded to a strip — the detail owns the width
  const [showConcluded, setShowConcluded] = useState(false)
  const [storeFilter, setStoreFilter] = useState('all')  // 'all' | a store present in the data (local/github/…)
  const [notice, setNotice] = useState('')
  const [sel, setSel] = useState(null)            // the ONE selection: 'issue:<id>'
  const rowsRef = useRef([])                      // the issue key list, for j/k

  // a write must show up where it lands: force the app-resident list to refetch (ETag makes it cheap).
  const load = useCallback(() => reloadIssues?.(true), [reloadIssues])

  const flash = (outcomes) => { if (outcomes) { setNotice(outcomes); setTimeout(() => setNotice(''), 6000) } }

  const all = Array.isArray(data?.issues) ? data.issues : []
  // a CONCLUDED issue (forge closed; local rejected/landed) hides by default — the list is the open work,
  // not the archive. open + accepted stay (accepted is approved-but-not-landed: still live).
  const concluded = (i) => i.status === 'closed' || i.status === 'rejected' || i.status === 'landed'
  // the store filter's options come from the DATA, not a hardcoded list — a new store (gitlab) appears
  // in the dropdown the day its driver lands. Default 'all' keeps the stores mixed in API order.
  const stores = [...new Set(all.map((i) => i.store).filter(Boolean))]
  const stored = storeFilter === 'all' ? all : all.filter((i) => i.store === storeFilter)
  const issues = showConcluded ? stored : stored.filter((i) => !concluded(i))
  const openCount = stored.filter((i) => i.status === 'open').length
  const concludedCount = stored.filter(concluded).length

  const issueByKey = useMemo(() => new Map(issues.map((i) => [`issue:${i.id}`, i])), [issues])
  rowsRef.current = issues.map((i) => `issue:${i.id}`)
  // default selection: the list's first row — the detail pane is never idle by default.
  const effSel = sel && issueByKey.has(sel) ? sel : rowsRef.current[0] ?? null

  // page keys ([[issues-view]]): j/k walk the issue list; the detail follows the selection (no Enter —
  // selection IS detail). Capture phase; a key typed into an input/textarea or carrying a modifier is
  // never ours.
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

  const selIssue = effSel ? issueByKey.get(effSel) : null

  return (
    <div className={`fv-master ${folded ? 'folded' : ''}`}>
      {/* the list column stays MOUNTED while folded (filter state + j/k live in it) — the fold is pure
          CSS; the thin strip is the unfold affordance. */}
      {folded && <button type="button" className="fv-unfold" title={t('masterList.unfold')} onClick={() => setFolded(false)}>›</button>}
      <div className="fv-list-col" style={folded ? { display: 'none' } : undefined}>
        <button type="button" className="fv-fold" title={t('masterList.fold')} onClick={() => setFolded(true)}>‹</button>
        {notice && <div className="fv-notice">{notice}</div>}
        <section className="fv-group">
          <header className="fv-group-head">
            <span className="ef-chipbar">
              {stores.length > 1 && (
                <select className="fv-store-filter" value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
                  <option value="all">{t('session.issuesStoreAll')}</option>
                  {stores.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
              <button type="button" className="fv-new-btn" onClick={() => setComposing((v) => !v)}>
                {composing ? t('session.issuesCancel') : t('session.issuesNew')}
              </button>
              {concludedCount > 0 && (
                <button type="button" className={`ef-chip fv-concluded ${showConcluded ? 'on' : ''}`} onClick={() => setShowConcluded((v) => !v)}>
                  {t('nodeView.closedIssues', { n: concludedCount })}
                </button>
              )}
            </span>
            <span className="fv-group-meta">{t('session.issuesThreadsSummary', { open: openCount, total: stored.length })}</span>
          </header>
          {composing && <NewThreadForm specs={specs} sessions={sessions} onDone={async (outcomes) => { setComposing(false); flash(outcomes); await load() }} />}
          {!issues.length && <div className="fv-note">{t('session.issuesEmpty')}</div>}
          {issues.map((th) => {
            const k = `issue:${th.id}`
            return (
              <button key={th.id} className={`fv-row ${effSel === k ? 'sel' : ''}`} onClick={() => setSel(k)}>
                <span className={`fv-store fv-store-${th.store === 'local' ? 'local' : 'forge'}`}>{th.store}</span>
                <span className="fv-concern">{th.concern}</span>
                {th.status && <span className={`fv-status fv-st-${th.status}`}>{th.status}</span>}
                {(th.replies?.length ?? 0) > 0 && <span className="fv-count">{t('session.issuesReplies', { n: th.replies.length })}</span>}
              </button>
            )
          })}
        </section>
      </div>
      <div className="fv-detail">
        {selIssue
          ? <IssueDetail issue={selIssue} specs={specs} sessions={sessions} onFocusNode={onFocusNode} onWrite={async (outcomes) => { flash(outcomes); await load() }} />
          : <div className="fv-note">{t('session.issuesEmpty')}</div>}
      </div>
    </div>
  )
}

// the issue detail — full-height: header (store/status/author/node chips/permalink), the markdown-RENDERED
// body, the reply thread, and the composer — one thread surface for both stores.
function IssueDetail({ issue: th, specs, sessions, onFocusNode, onWrite }) {
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
        {/* the originator (who filed) + whether their session is still ALIVE — a local thread's `by` is a
            session id (join it against the board for liveness); a forge issue's `by` is a github login that
            resolves to no session, so it stays a plain label. */}
        {local
          ? <OriginatorLiveness originator={th.by} sessions={sessions} kind="issue" />
          : (th.by && <span className="fv-by">{th.by}</span>)}
        {/* signers badge only when someone actually signed — a "+0 signed" is noise (mirrors the CLI's
            `if (p.signers.length)` guard, issues.ts). The sign feature itself is untouched. */}
        {local && signers.length > 0 && <span className="fv-count">{t('session.issuesSigned', { n: signers.length })}</span>}
        {nodes.map((id) => (
          <button key={id} type="button" className="fv-chip" onClick={() => onFocusNode?.(id)} title={t('session.issuesFocusNode')}>{id}</button>
        ))}
        {th.url && <a className="fv-link" href={th.url} target="_blank" rel="noreferrer">{t('session.issuesOpenOnForge')}</a>}
      </div>
      {th.body && <div className="fvd-body"><SpecBody body={th.body} /></div>}
      <Replies replies={replies} />
      <ReplyComposer onSend={(text, evidence) => postIssueReply(th.id, text, evidence)} specs={specs} sessions={sessions} focusId={nodes[0] || null} onDone={onWrite} />
    </div>
  )
}

// the "New" affordance — a concern line and a body. Posts a fresh LOCAL issue as 'human' (a new thread
// opens local; promotion is what moves one to the forge); an @-mention in the body dispatches, and a
// `[[node]]` link in the text IS the node link — the store infers the thread's `nodes:` from them, so
// there is no separate node-ids field to re-type. The body textarea carries the shared
// `[[node]]`/`@session` autocomplete ([[mentions]]) — the form sits at the top of the list column, so its
// menu opens downward.
function NewThreadForm({ specs, sessions, onDone }) {
  const t = useT()
  const [concern, setConcern] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const taRef = useRef(null)
  const ac = useMentionAutocomplete({ inputRef: taRef, value: body, setValue: setBody, specs, sessions })
  const submit = async () => {
    const c = concern.trim()
    if (!c || busy) return
    setBusy(true)
    try {
      const res = await postIssueThread({ concern: c, body: body.trim() || undefined })
      if (res?.ok) { setConcern(''); setBody(''); await onDone?.(res.outcomes || '') }
    } finally { setBusy(false) }
  }
  return (
    <div className="fv-new-form">
      <input className="fv-input" value={concern} placeholder={t('session.issuesConcernPlaceholder')}
        disabled={busy} onChange={(e) => setConcern(e.target.value)} />
      <div className="fv-tawrap">
        <textarea ref={taRef} className="fv-textarea" rows={3} value={body} placeholder={t('session.issuesBodyPlaceholder')}
          disabled={busy} onChange={(e) => { setBody(e.target.value); ac.sync(e.target) }}
          onSelect={(e) => ac.sync(e.target)} onBlur={ac.close}
          onKeyDown={(e) => { if (ac.onKeyDown(e)) return; if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }} />
        {ac.menuEl}
      </div>
      <div className="fv-actions">
        <span className="fv-hint">{t('session.issuesMentionHint')}</span>
        <button type="button" className="fv-send" disabled={busy || !concern.trim()} onClick={submit}>
          {busy ? t('session.issuesSending') : t('session.issuesPost')}
        </button>
      </div>
    </div>
  )
}
