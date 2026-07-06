import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { postIssueClose, postIssuePromote, postIssueReply, postIssueResolve, postIssueSign, postIssueThread } from './data.js'
import { useMentionAutocomplete } from './mentions.jsx'
import { SpecBody } from './NodeView.jsx'
import { Replies, ReplyComposer, OriginatorLiveness } from './Thread.jsx'
import { useT } from './i18n/index.jsx'
import Modal from './Modal.jsx'
import { useEscLayer } from './escStack.js'

// The Issues page ([[issues-view]]): a top-level page (#/issues, [[side-nav]]), peer of the graph, the
// session board, and the Evals page. MASTER-DETAIL over one full routed page — the LEFT column is the
// SLIM merged ISSUE list (local + forge, store-tagged, API order, no re-sort/no ranking; CONCLUDED
// issues hidden behind a count chip) under its own filter bar, foldable to a thin strip so the detail
// owns the width; the RIGHT pane is the full-height DETAIL of the selection — selection IS the detail,
// no in-place expansion in a small box: an issue renders its markdown body (SpecBody — the spec dialect),
// its replies, and the reply composer — BOTH stores ([[issues]]: the reply/close verbs route by store). j/k
// walk the issue list even while folded, the detail follows; writes post as 'human'. The evals are their
// OWN top-level page now ([[evals-view]]) — no in-page switcher here.
export default function IssuesPage({ onFocusNode, onOpenSession, specs = [], sessions = [], issuesData = null, reloadIssues }) {
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
  const writeStores = Array.isArray(data?.stores) && data.stores.length ? data.stores : [{ id: 'local', label: 'local', kind: 'local' }]
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
  useEscLayer(composing, () => setComposing(false))
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
              <button type="button" className="fv-new-btn" onClick={() => setComposing(true)}>
                {t('session.issuesNew')}
              </button>
              {concludedCount > 0 && (
                <button type="button" className={`ef-chip fv-concluded ${showConcluded ? 'on' : ''}`} onClick={() => setShowConcluded((v) => !v)}>
                  {t('nodeView.closedIssues', { n: concludedCount })}
                </button>
              )}
            </span>
            <span className="fv-group-meta">{t('session.issuesThreadsSummary', { open: openCount, total: stored.length })}</span>
          </header>
          {!issues.length && <div className="fv-note">{t('session.issuesEmpty')}</div>}
          {/* a row leads with the ISSUE (status dot + concern); store/replies are trailing quiet meta —
              the store mini-tag renders only while stores are actually mixed ([[issues-view]]). */}
          {issues.map((th) => {
            const k = `issue:${th.id}`
            return (
              <button key={th.id} className={`fv-row ${effSel === k ? 'sel' : ''}`} onClick={() => setSel(k)}>
                <span className={`fv-dot st-${th.status || 'open'}`} title={th.status} />
                <span className="fv-concern">{th.concern}</span>
                {(th.replies?.length ?? 0) > 0 && <span className="fv-replies" title={t('session.issuesReplies', { n: th.replies.length })}>{th.replies.length}</span>}
                {stores.length > 1 && <span className={`fv-store fv-store-${th.store === 'local' ? 'local' : 'forge'}`}>{th.store}</span>}
              </button>
            )
          })}
        </section>
      </div>
      <div className="fv-detail">
        {selIssue
          ? <IssueDetail issue={selIssue} specs={specs} sessions={sessions} onFocusNode={onFocusNode} onOpenSession={onOpenSession} onWrite={async (outcomes) => { flash(outcomes); await load() }} />
          : <div className="fv-note">{t('session.issuesEmpty')}</div>}
      </div>
      {composing && (
        <Modal title={t('session.issuesNew')} closeLabel={t('common.close')} onClose={() => setComposing(false)} className="fv-new-modal">
          <NewThreadForm specs={specs} sessions={sessions} stores={writeStores} onCancel={() => setComposing(false)} onDone={async (outcomes) => { setComposing(false); flash(outcomes); await load() }} />
        </Modal>
      )}
    </div>
  )
}

// the issue detail — full-height, split like the eval rail: a scrolling thread region (header
// (store/status/author/node chips/permalink), the markdown-RENDERED body, the replies) over the composer
// DOCKED at the pane's foot — one thread surface for both stores, the write affordance always on screen.
// The composer's action row carries the issue's WHOLE human-reachable lifecycle at CLI parity
// ([[issues-view]]): Sign · Accept · Reject · Promote (local-store verbs — an open local issue only; sign
// hides once 'human' signed) beside the store-routed Close every non-concluded issue gets. Each POSTs to
// the thin endpoint wrapping the same store function the CLI verb calls, then reloads the resident list.
function IssueDetail({ issue: th, specs, sessions, onFocusNode, onOpenSession, onWrite }) {
  const t = useT()
  const local = th.store === 'local'
  const concluded = th.status === 'closed' || th.status === 'rejected' || th.status === 'landed'
  const [acting, setActing] = useState('')   // the lifecycle action in flight — one at a time
  const [actErr, setActErr] = useState('')
  const nodes = Array.isArray(th.nodes) ? th.nodes : []
  const signers = Array.isArray(th.signers) ? th.signers : []
  const replies = Array.isArray(th.replies) ? th.replies : []
  const run = (name, fn) => async () => {
    if (acting) return
    setActing(name)
    try {
      const res = await fn()
      if (res?.ok) { setActErr(''); await onWrite?.('') }
      else setActErr(res?.error || `${name} failed`)
    } finally {
      setActing('')
    }
  }
  const lifecycleBtn = (name, label, fn, title) => (
    <button type="button" className={`fv-close-issue fv-life-${name}`} disabled={!!acting} title={title}
      onMouseDown={(e) => e.preventDefault()} onClick={run(name, fn)}>
      {acting === name ? t('session.issuesActing') : label}
    </button>
  )
  return (
    <div className="fvd">
      <div className="fvd-scroll">
        {/* the title is the concern ALONE — the store is metadata, never identity: it lives in the meta
            strip below, never on the title ([[issues-view]]). */}
        <header className="fvd-head">
          <span className="fvd-concern">{th.concern}</span>
        </header>
        <div className="fvd-meta">
          {th.status && <span className={`fv-status fv-st-${th.status}`}>{th.status}</span>}
          <span className={`fv-store fv-store-${local ? 'local' : 'forge'}`}>{th.store}</span>
          {/* the originator (who filed) + whether their session is still ALIVE — a local thread's `by` is a
              session id (join it against the board for liveness, click through when live); a forge issue's
              `by` is a github login that resolves to no session, so it stays a plain label. */}
          {local
            ? <OriginatorLiveness originator={th.by} sessions={sessions} kind="issue" onOpenSession={onOpenSession} />
            : (th.by && <span className="fv-by">{th.by}</span>)}
          {/* signers badge only when someone actually signed — a "+0 signed" is noise (mirrors the CLI's
              `if (p.signers.length)` guard, issues.ts). */}
          {local && signers.length > 0 && <span className="fv-count" title={signers.join(', ')}>{t('session.issuesSigned', { n: signers.length })}</span>}
          {nodes.map((id) => (
            <button key={id} type="button" className="fv-chip" onClick={() => onFocusNode?.(id)} title={t('session.issuesFocusNode')}>{id}</button>
          ))}
          {th.url && <a className="fv-link" href={th.url} target="_blank" rel="noreferrer">{t('session.issuesOpenOnForge')}</a>}
        </div>
        {th.body && <div className="fvd-body"><SpecBody body={th.body} /></div>}
        {/* a reply that is a REMARK gets its resolve/retract verb here too ([[remark-substrate]] — a remark
            can host on an issue, not only a scenario); the shared Thread UI enforces nothing itself. */}
        <Replies replies={replies} threadId={local ? th.id : null} onRemarkChange={() => onWrite?.('')} />
      </div>
      {/* the composer is DOCKED at the detail's foot ([[issues-view]]) — always on screen, the thread
          scrolls behind it (no scroll-to-the-bottom to reply); keyed to the issue so a half-typed draft
          dies with its selection instead of leaking onto another issue's thread. */}
      <div className="fvd-compose">
        <ReplyComposer
          key={th.id}
          onSend={(text, evidence) => postIssueReply(th.id, text, evidence)}
          specs={specs}
          sessions={sessions}
          focusId={nodes[0] || null}
          onDone={onWrite}
          actionsEnd={!concluded && (
            <>
              {actErr && <span className="fv-error">{actErr}</span>}
              {local && th.status === 'open' && !signers.includes('human') &&
                lifecycleBtn('sign', t('session.issuesSign'), () => postIssueSign(th.id), t('session.issuesSignTitle'))}
              {local && th.status === 'open' && <>
                {lifecycleBtn('accept', t('session.issuesAccept'), () => postIssueResolve(th.id, 'accepted'), t('session.issuesAcceptTitle'))}
                {lifecycleBtn('reject', t('session.issuesReject'), () => postIssueResolve(th.id, 'rejected'), t('session.issuesRejectTitle'))}
                {lifecycleBtn('promote', t('session.issuesPromote'), () => postIssuePromote(th.id), t('session.issuesPromoteTitle'))}
              </>}
              {lifecycleBtn('close', t('session.issuesCloseIssue'), () => postIssueClose(th.id))}
            </>
          )}
        />
      </div>
    </div>
  )
}

const storeGlyph = (s) => s.id === 'local' ? 'L' : s.id === 'github' ? 'GH' : s.id === 'gitlab' ? 'GL' : (s.id || '?').slice(0, 2).toUpperCase()

// the "New" affordance — a concern line, a body, and one compact store picker. Local posts to the
// git-native local store; a configured forge store posts a REAL forge issue through the same issue port.
// A `[[node]]` link in the text IS the node link — local infers `nodes:`, forge writes the `Spec:` marker
// from the same prose. No separate node-ids field exists. The shared `[[node]]`/`@session` autocomplete
// opens above the pop-out, not as inserted modal content.
function NewThreadForm({ specs, sessions, stores, onCancel, onDone }) {
  const t = useT()
  const [store, setStore] = useState(stores[0]?.id || 'local')
  const [concern, setConcern] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const taRef = useRef(null)
  const ac = useMentionAutocomplete({ inputRef: taRef, value: body, setValue: setBody, specs, sessions, up: true, fixedAbove: '.fv-new-modal' })
  useEffect(() => {
    if (!stores.some((s) => s.id === store)) setStore(stores[0]?.id || 'local')
  }, [stores, store])
  const submit = async () => {
    const c = concern.trim()
    if (!c || busy) return
    setBusy(true)
    setErr('')
    try {
      const res = await postIssueThread({ concern: c, body: body.trim() || undefined, store })
      if (res?.ok) { setConcern(''); setBody(''); await onDone?.(res.outcomes || '') }
      else setErr(res?.error || t('session.issuesPostFailed'))
    } finally { setBusy(false) }
  }
  return (
    <div className="fv-new-form">
      <label className="fv-store-pick">
        <span>{t('session.issuesStoreLabel')}</span>
        <select value={store} disabled={busy} onChange={(e) => setStore(e.target.value)}>
          {stores.map((s) => <option key={s.id} value={s.id}>{storeGlyph(s)} · {s.label || s.id}</option>)}
        </select>
      </label>
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
        <span className={err ? 'fv-error' : 'fv-hint'}>{err || t('session.issuesMentionHint')}</span>
        <button type="button" className="fv-cancel" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button>
        <button type="button" className="fv-send" disabled={busy || !concern.trim()} onClick={submit}>
          {busy ? t('session.issuesSending') : t('session.issuesPost')}
        </button>
      </div>
    </div>
  )
}
