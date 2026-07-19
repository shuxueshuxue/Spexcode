import { useEffect, useState, useRef } from 'react'
import { postIssueClose, postIssuePromote, postIssueReply, postIssueThread } from './data.js'
import { useMentionAutocomplete } from './mentions.jsx'
import { useLaunchers } from './launch.js'
import { SpecBody } from './NodeView.jsx'
import { Replies, ReplyComposer, OriginatorLiveness } from './Thread.jsx'
import { useT } from './i18n/index.jsx'
import { liveSession } from './session.js'
import FilterSelect from './FilterSelect.jsx'
import Modal from './Modal.jsx'
import { ListPage, DetailShell, SideSection } from './ReviewShell.jsx'
import { navigate, routeHash, useRoute } from './route.js'
import { Icon, IconButton } from './icons.jsx'
import { useEscLayer } from './escStack.js'

// The Issues surface ([[issues-view]]): GitHub-style TWO pages over one route family, both wearing the
// shared [[review-chrome]]. `#/issues` is the LIST page — the merged local+forge list (store-tagged, API
// order, no re-sort), one-line rows that are REAL anchors, filters in the URL query; `#/issues/<id>` is
// the standalone DETAIL page — the markdown body + reply thread as the main column with the composer
// docked at its foot, the status/store/originator/node metadata in the side rail. A row click PUSHES;
// browser Back restores the exact filtered list; both pages are directly openable. Writes post as
// 'human' and route by store ([[issues]]).

const statusIconOf = (status) => (status === 'open' ? 'issue-opened' : 'issue-closed')
const concluded = (i) => i.status !== 'open'

// The LIST page (`#/issues[?query]`): RESIDENT data — the page renders instantly from app-held state
// ([[issues-view]]); filters (store / concluded reveal / live chip) are URL-query state, re-derived on
// every hashchange so Back replays them exactly.
export function IssuesListPage({ data, reloadIssues, specs, sessions, query, notice, flash }) {
  const t = useT()
  const [composing, setComposing] = useState(false)
  useEscLayer(composing, () => setComposing(false))
  if (data == null) return <div className="fv-note">{t('session.issuesLoading')}</div>
  if (!data.enabled) return <div className="fv-note">{t('session.issuesOff')}</div>

  const all = Array.isArray(data.issues) ? data.issues : []
  const storeFilter = query.store || 'all'
  const showConcluded = query.concluded === '1'
  const liveOnly = query.live === '1'
  // a human's filter pick PUSHES the new list address (GitHub's semantics — Back walks filter history).
  const set = (patch) => navigate('issues', null, { query: { ...query, ...patch } })

  // the store filter's options come from the DATA, not a hardcoded list — a new store (gitlab) appears
  // in the dropdown the day its driver lands. Default 'all' keeps the stores mixed in API order.
  const stores = [...new Set(all.map((i) => i.store).filter(Boolean))]
  const writeStores = Array.isArray(data.stores) && data.stores.length ? data.stores : [{ id: 'local', label: 'local', kind: 'local' }]
  const stored = storeFilter === 'all' ? all : all.filter((i) => i.store === storeFilter)
  // [[live-session-filter]]: an issue is LIVE while a session behind it is still alive — its originator
  // (i.by) or any reply author; the join is session.js's liveSession, the same judgment the originator
  // chip's dot renders, so the chip-filtered list and the dots can never disagree.
  const isLive = (i) => !!liveSession(sessions, i.by) || (Array.isArray(i.replies) && i.replies.some((r) => liveSession(sessions, r.by)))
  const shown = showConcluded ? stored : stored.filter((i) => !concluded(i))
  const issues = liveOnly ? shown.filter(isLive) : shown
  const liveCount = shown.filter(isLive).length
  const concludedCount = stored.filter(concluded).length

  // a row leads with the ISSUE (status mark + concern); store/replies are trailing quiet meta —
  // the store mini-tag renders only while stores are actually mixed ([[issues-view]]).
  const rows = issues.map((th) => {
    const status = th.status || 'open'
    return {
      key: th.id,
      href: routeHash('issues', th.id),
      content: (
        <>
          <span className={`fv-status-mark ${status === 'open' ? 'open' : 'concluded'}`} data-tip={status}>
            <Icon name={statusIconOf(status)} size={16} />
          </span>
          <span className="fv-concern" data-tip={th.concern}>{th.concern}</span>
          {(th.replies?.length ?? 0) > 0 && <span className="fv-replies" data-tip={t('session.issuesReplies', { n: th.replies.length })}>{th.replies.length}</span>}
          {stores.length > 1 && <span className={`fv-store fv-store-${th.store === 'local' ? 'local' : 'forge'}`}>{th.store}</span>}
        </>
      ),
    }
  })

  const chips = (liveOnly || liveCount > 0 || concludedCount > 0) ? (
    <>
      {/* [[live-session-filter]]: the live chip self-hides at N=0 ONLY while the filter is OFF; once on it
          stays mounted as liveCount → 0 (the originating sessions close), so the filter is always
          releasable and the list never dead-ends empty. */}
      {(liveOnly || liveCount > 0) && (
        <button type="button" className={`ef-chip fv-live ${liveOnly ? 'on' : ''}`} onClick={() => set({ live: liveOnly ? null : '1' })}
          data-tip={t('masterList.liveChipTitle')}>
          {t('masterList.liveChip', { n: liveCount })}
        </button>
      )}
      {concludedCount > 0 && (
        <button type="button" className={`ef-chip fv-concluded ${showConcluded ? 'on' : ''}`} onClick={() => set({ concluded: showConcluded ? null : '1' })}>
          {t('nodeView.closedIssues', { n: concludedCount })}
        </button>
      )}
    </>
  ) : null

  return (
    <ListPage
      notice={notice}
      controls={
        <>
          {stores.length > 1 && (
            <FilterSelect value={storeFilter} onChange={(v) => set({ store: v === 'all' ? null : v })}
              options={[{ value: 'all', label: t('session.issuesStoreAll') }, ...stores.map((s) => ({ value: s, label: s }))]} />
          )}
          <IconButton icon="plus" size={12} className="fv-new-btn" label={t('session.issuesNew')} onClick={() => setComposing(true)} />
        </>
      }
      chips={chips}
      rows={rows}
      empty={t('session.issuesEmpty')}
    >
      {composing && (
        <Modal title={t('session.issuesNew')} closeLabel={t('common.close')} onClose={() => setComposing(false)} className="fv-new-modal">
          <NewThreadForm specs={specs} sessions={sessions} stores={writeStores} onCancel={() => setComposing(false)}
            onDone={async (outcomes) => { setComposing(false); flash(outcomes); await reloadIssues?.(true) }} />
        </Modal>
      )}
    </ListPage>
  )
}

// The DETAIL page (`#/issues/<id>`) — [[review-chrome]]'s GitHub-grammar skeleton: the concern ALONE as
// the title, the status band under it, the markdown body + reply thread as the MAIN column with the
// composer docked at its foot, and the store/originator/node/permalink metadata in the SIDE rail (reflowed
// above the body at phone width). One thread surface for both stores; the only store-specific affordances
// are metadata. Sign/accept/reject are not product verbs.
export function IssueDetailPage({ issue: th, specs, sessions, onFocusNode, onOpenSession, onWrite, notice }) {
  const t = useT()
  const local = th.store === 'local'
  const isConcluded = concluded(th)
  const [acting, setActing] = useState('')   // the lifecycle action in flight — one at a time
  const [actErr, setActErr] = useState('')
  const nodes = Array.isArray(th.nodes) ? th.nodes : []
  const replies = Array.isArray(th.replies) ? th.replies : []
  const status = th.status || 'open'
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
    <button type="button" className={`fv-close-issue fv-life-${name}`} disabled={!!acting} data-tip={title}
      onMouseDown={(e) => e.preventDefault()} onClick={run(name, fn)}>
      {acting === name ? t('session.issuesActing') : label}
    </button>
  )
  return (
    <DetailShell
      title={th.concern}
      status={
        <span className={`fv-status fv-st-${status} ds-status-pill`}>
          <Icon name={statusIconOf(status)} size={14} /> {status}
        </span>
      }
      side={
        <>
          <SideSection label={t('detail.sideStore')}>
            <span className={`fv-store fv-store-${local ? 'local' : 'forge'}`}>{th.store}</span>
            {th.url && <a className="fv-link" href={th.url} target="_blank" rel="noreferrer">{t('session.issuesOpenOnStore', { store: storeDisplayName(th.store) })}</a>}
          </SideSection>
          {/* the originator (who filed) + whether their session is still ALIVE — a local thread's `by` is a
              session id (join it against the board for liveness, click through when live); a forge issue's
              `by` is a github login that resolves to no session, so it stays a plain label. */}
          {th.by && (
            <SideSection label={t('detail.sideOriginator')}>
              {local
                ? <OriginatorLiveness originator={th.by} sessions={sessions} kind="issue" onOpenSession={onOpenSession} />
                : <span className="fv-by">{th.by}</span>}
            </SideSection>
          )}
          {nodes.length > 0 && (
            <SideSection label={t('detail.sideNodes')}>
              {nodes.map((id) => (
                <button key={id} type="button" className="fv-chip" onClick={() => onFocusNode?.(id)} data-tip={t('session.issuesFocusNode')}>{id}</button>
              ))}
            </SideSection>
          )}
        </>
      }
      composer={
        // the composer is DOCKED at the main column's foot ([[issues-view]]) — always on screen, the
        // thread scrolls behind it; keyed to the issue so a half-typed draft dies with its page instead of
        // leaking onto another issue's thread.
        <ReplyComposer
          key={th.id}
          onSend={(text, evidence) => postIssueReply(th.id, text, evidence)}
          specs={specs}
          sessions={sessions}
          focusId={nodes[0] || null}
          onDone={onWrite}
          actionsEnd={!isConcluded && (
            <>
              {actErr && <span className="fv-error">{actErr}</span>}
              {local && lifecycleBtn('promote', t('session.issuesPromote'), () => postIssuePromote(th.id), t('session.issuesPromoteTitle'))}
              {lifecycleBtn('close', t('session.issuesCloseIssue'), () => postIssueClose(th.id), t('session.issuesCloseIssueTitle'))}
            </>
          )}
        />
      }
    >
      {notice && <div className="fv-notice">{notice}</div>}
      {th.body && <div className="fvd-body"><SpecBody body={th.body} /></div>}
      {/* a reply that is a REMARK gets its resolve/retract verb here too ([[remark-substrate]] — a remark
          can host on an issue, not only a scenario); the shared Thread UI enforces nothing itself. */}
      <Replies replies={replies} threadId={local ? th.id : null} onRemarkChange={() => onWrite?.('')} />
    </DetailShell>
  )
}

export default function IssuesPage({ onFocusNode, onOpenSession, specs = [], sessions = [], issuesData = null, reloadIssues }) {
  const t = useT()
  const { param, query } = useRoute()
  const [notice, setNotice] = useState('')
  const flash = (outcomes) => { if (outcomes) { setNotice(outcomes); setTimeout(() => setNotice(''), 6000) } }
  // a write must show up where it lands: force the app-resident list to refetch (ETag makes it cheap).
  const onWrite = async (outcomes) => { flash(outcomes); await reloadIssues?.(true) }

  if (param) {
    if (issuesData == null) return <div className="fv-note">{t('session.issuesLoading')}</div>
    if (!issuesData.enabled) return <div className="fv-note">{t('session.issuesOff')}</div>
    const th = (issuesData.issues || []).find((i) => i.id === param)
    if (!th) {
      // an address naming no issue renders the honest not-found with the list link ([[review-chrome]]).
      return <DetailShell missing={t('reviewShell.issueNotFound', { id: param })} listHref={routeHash('issues')} listLabel={t('reviewShell.backToIssues')} />
    }
    return <IssueDetailPage issue={th} specs={specs} sessions={sessions} onFocusNode={onFocusNode}
      onOpenSession={onOpenSession} onWrite={onWrite} notice={notice} />
  }
  return <IssuesListPage data={issuesData} reloadIssues={reloadIssues} specs={specs} sessions={sessions}
    query={query} notice={notice} flash={flash} />
}

// canonical store display names — the permalink label derives from the issue's OWN `store` identity
// ([[issues-view]]): one data row per forge store, never a URL sniff and never a per-host branch in the
// component; a store without a row falls back to its raw id, so a new driver reads honestly before its
// row lands.
const STORE_DISPLAY_NAMES = { github: 'GitHub', gitlab: 'GitLab' }
const storeDisplayName = (id) => STORE_DISPLAY_NAMES[id] || id

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
  const { launchers } = useLaunchers()
  const ac = useMentionAutocomplete({ inputRef: taRef, value: body, setValue: setBody, specs, sessions, launchers, up: true, fixedAbove: '.fv-new-modal' })
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
          {stores.map((s) => <option key={s.id} value={s.id}>{s.label || s.id}</option>)}
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
        {err && <span className="fv-error">{err}</span>}
        <button type="button" className="fv-cancel" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button>
        <button type="button" className="fv-post" disabled={busy || !concern.trim()} onClick={submit}>
          {busy ? t('session.issuesSending') : t('session.issuesPost')}
        </button>
      </div>
    </div>
  )
}
