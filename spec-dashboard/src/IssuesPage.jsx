import { useCallback, useEffect, useState, useRef } from 'react'
import { loadIssue, postIssueClose, postIssuePromote, postIssueReply, postIssueThread } from './data.js'
import { useMentionAutocomplete } from './mentions.jsx'
import { useLaunchers } from './launch.js'
import { SpecBody } from './NodeView.jsx'
import { Replies, ReplyComposer, OriginatorLiveness } from './Thread.jsx'
import { useT } from './i18n/index.jsx'
import Modal from './Modal.jsx'
import { DetailShell, FacetMenu, ListPage, ReviewListRow, ReviewState, SecondaryFilters, SideSection, SideValue } from './ReviewShell.jsx'
import { ISSUE_QUERY_DEFAULT, queryParam, readToken, reviewRouteQuery, setToken } from './reviewQuery.js'
import { reviewActorName } from './reviewFilters.js'
import { reviewPageNumber, useReviewPage } from './reviewPage.js'
import { navigate, routeHash, useRoute } from './route.js'
import { detailBackHash } from './address.js'
import { Icon } from './icons.jsx'
import { useEscLayer } from './escStack.js'

// The Issues surface ([[issues-view]]): GitHub-style TWO pages over one route family, both wearing the
// shared [[review-chrome]]. `#/issues` is the LIST page — the merged local+forge list (store-tagged, API
// order, no re-sort), structured rows that are REAL anchors, query/sections/facets in the URL; `#/issues/<id>` is
// the standalone DETAIL page — the markdown body + reply thread as the main column with the composer
// docked at its foot, the status/store/originator/node metadata in the side rail. A row click PUSHES;
// browser Back restores the exact filtered list; both pages are directly openable. Writes post as
// 'human' and route by store ([[issues]]).

const concluded = (i) => i.status !== 'open'

const age = (ts) => {
  const seconds = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
  if (!Number.isFinite(seconds)) return ''
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

const issueNumber = (id) => {
  const parts = String(id || '').split('#')
  const value = parts.length > 1 ? parts.at(-1) : parts[0]
  return `#${value.length > 16 ? `${value.slice(0, 13)}…` : value}`
}

// the page's recognized qualifier vocabulary — what the highlight overlay colors and the key
// autocomplete offers; anything else stays plain and matches nothing.
export const ISSUE_QUERY_KEYS = ['is', 'state', 'store', 'author', 'node', 'session']

// The LIST page (`#/issues[?q=<raw tokens>]`) requests one resident-source page from the server; the WHOLE
// face is ONE visible token query ([[review-query]]) bridged into the
// ONE field-semantics engine ([[review-filters]]): sections and low-cardinality menus are pure builders
// doing token surgery + PUSH over the COMMITTED text, author/node are token-only, and the list
// re-derives everything from the URL on every hashchange so Back replays it exactly.
const facetOptions = (data, key, allLabel, labelValue = (value) => value) => (data?.facets?.[key]?.options ?? []).map((option) => ({
  value: option.value,
  label: option.value === '' ? allLabel : labelValue(option.value),
}))

export function IssuesListPage({ data, loading, error, reload, specs, sessions, query, notice, flash }) {
  const t = useT()
  const [composing, setComposing] = useState(false)
  useEscLayer(composing, () => setComposing(false))
  if (data && !data.enabled) return <div className="fv-note">{t('session.issuesOff')}</div>

  const all = Array.isArray(data?.items) ? data.items : []
  const text = String(query.q ?? '').trim() || ISSUE_QUERY_DEFAULT
  // a human's edit/tab/menu action PUSHES the canonical address — bare for the default view, exactly
  // ?q=<raw text> otherwise (GitHub's semantics — Back walks filter history).
  const push = (nextText) => navigate('issues', null, { query: queryParam(nextText, ISSUE_QUERY_DEFAULT) })
  const surgery = (key, value) => push(setToken(text, key, value))

  // Store options come from DATA, not a hardcoded list — a new adapter appears without new chrome.
  const stores = (data?.facets?.store?.options ?? []).map((option) => option.value).filter(Boolean)
  const writeStores = Array.isArray(data?.stores) && data.stores.length ? data.stores : [{ id: 'local', label: 'local', kind: 'local' }]
  const issues = all
  const openCount = data?.counts?.open || 0
  const closedCount = data?.counts?.closed || 0
  const section = readToken(text, 'state')

  // a row leads with the ISSUE (status mark + concern); store/replies are trailing quiet meta —
  // the store mini-tag renders only while stores are actually mixed ([[issues-view]]).
  const rows = issues.map((th) => {
    const status = th.status || 'open'
    return {
      key: th.id,
      href: routeHash('issues', th.id),
      content: (
        <>
          <ReviewListRow
            state={<ReviewState kind="issue" state={status} />}
            title={th.concern}
            meta={(
              <>
                <span data-tip={th.id}>{issueNumber(th.id)}</span>
                {th.by && <span data-tip={th.by}>{t('reviewList.openedBy', { by: reviewActorName(th.by) })}</span>}
                {th.created && <span>{t('reviewList.openedAt', { at: age(th.created) })}</span>}
              </>
            )}
            aside={(
              <>
                {(th.replies?.length ?? 0) > 0 && <span className="rl-comments" data-tip={t('session.issuesReplies', { n: th.replies.length })}><Icon name="message-square" size={14} />{th.replies.length}</span>}
                {stores.length > 1 && <span className={`rl-tag fv-store-${th.store === 'local' ? 'local' : 'forge'}`}>{th.store}</span>}
                {th.nodes?.[0] && <span className="rl-tag node">{th.nodes[0]}</span>}
              </>
            )}
          />
        </>
      ),
    }
  })

  // menus are pure query builders over the ADAPTER's data-derived options — zero private state.
  const storeFacet = { label: t('reviewList.facetStore'), value: readToken(text, 'store'), options: facetOptions(data, 'store', t('reviewList.all')) }
  const sessionFacet = {
    label: t('reviewList.facetSession'), value: readToken(text, 'session'),
    options: facetOptions(data, 'session', t('reviewList.all'), (value) => t(value === 'present' ? 'reviewList.sessionPresent' : 'reviewList.sessionMissing')),
  }

  return (
    <ListPage
      notice={notice}
      loading={loading}
      error={error}
      title={t('reviewList.issuesTitle')}
      action={<button type="button" className="rl-new" onClick={() => setComposing(true)}><Icon name="plus" size={14} />{t('session.issuesNew')}</button>}
      search={{
        value: String(query.q ?? '').trim() ? query.q : ISSUE_QUERY_DEFAULT,
        onSubmit: push,
        placeholder: t('reviewList.searchIssues'),
        label: t('reviewList.search'),
        keys: ISSUE_QUERY_KEYS,
        // bounded autocomplete candidates for the HIGH-cardinality tokens: values present in the data
        // only; an unknown or historical value still submits verbatim.
        suggest: {
          author: facetOptions(data, 'author', t('reviewList.all')).filter((option) => option.value),
          node: facetOptions(data, 'node', t('reviewList.all')).filter((option) => option.value),
        },
      }}
      sections={[
        // Open is the DEFAULT section: with no state: token it stays the active tab, so the tablist
        // always exposes one roving tab stop; every non-open state spelling belongs to Closed.
        { key: 'open', label: t('reviewList.open'), count: openCount, active: section === '' || section === 'open', onSelect: () => surgery('state', 'open') },
        { key: 'closed', label: t('reviewList.closed'), count: closedCount, active: section !== '' && section !== 'open', onSelect: () => surgery('state', 'closed') },
      ]}
      facets={
        <FacetMenu label={storeFacet.label} value={storeFacet.value} options={storeFacet.options} clearLabel={t('reviewList.all')} onChange={(value) => surgery('store', value)} mobile />
      }
      secondaryFilters={<SecondaryFilters label={t('reviewList.filters')} clearLabel={t('reviewList.all')} groups={[
        { label: sessionFacet.label, value: sessionFacet.value, active: !!sessionFacet.value, options: sessionFacet.options, onChange: (value) => surgery('session', value) },
      ]} />}
      rows={rows}
      pagination={data ? {
        page: data.page, pageCount: data.pageCount, prev: data.prev, next: data.next,
        hrefFor: (target) => routeHash('issues', null, reviewRouteQuery(text, ISSUE_QUERY_DEFAULT, target)),
      } : null}
      empty={{
        hasData: (data?.sourceTotal ?? 0) > 0,
        dataset: t('session.issuesEmpty'),
        filtered: t('session.issuesNoMatch'),
      }}
    >
      {composing && (
        <Modal title={t('session.issuesNew')} closeLabel={t('common.close')} onClose={() => setComposing(false)} className="fv-new-modal">
          <NewThreadForm specs={specs} sessions={sessions} stores={writeStores} onCancel={() => setComposing(false)}
            onDone={async (outcomes) => { setComposing(false); flash(outcomes); await reload?.() }} />
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
      backHref={detailBackHash('issues')}
      backLabel={t('detail.backToIssues')}
      status={
        <ReviewState kind="issue" state={status} showLabel className="ds-status-pill" size={16} />
      }
      side={
        <>
          {/* the issue's OWN identity, explicitly typed ([[review-chrome]]'s metadata law — a bare
              #slug reads as a node): a localized Issue label over the full id, shrink-truncated with
              the full slug on the tooltip. */}
          <SideSection label={t('detail.sideIssue')}>
            <SideValue text={th.id} mono />
          </SideSection>
          <SideSection label={t('detail.sideStore')}>
            <SideValue text={th.store} className={`fv-store fv-store-${local ? 'local' : 'forge'}`} />
            {th.url && <SideValue text={t('session.issuesOpenOnStore', { store: storeDisplayName(th.store) })} href={th.url} external />}
          </SideSection>
          {/* the originator (who filed) + whether their session is still ALIVE — a local thread's `by` is a
              session id (join it against the board for liveness, click through when live); a forge issue's
              `by` is a github login that resolves to no session, so it stays a plain labeled value. */}
          {th.by && (
            <SideSection label={t('detail.sideOriginator')}>
              {local
                ? <OriginatorLiveness originator={th.by} sessions={sessions} kind="issue" onOpenSession={onOpenSession} />
                : <SideValue text={th.by} dim />}
            </SideSection>
          )}
          {nodes.length > 0 && (
            <SideSection label={t('detail.sideNodes')}>
              {nodes.map((id) => (
                <SideValue key={id} text={id} mono tip={t('session.issuesFocusNode')} onClick={() => onFocusNode?.(id)} />
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

function useIssueDetail(id) {
  const [issue, setIssue] = useState(null)
  const [error, setError] = useState(null)
  const seq = useRef(0)
  const reload = useCallback(async () => {
    if (!id) return null
    const mine = ++seq.current
    setError(null)
    try {
      const value = await loadIssue(id)
      if (mine === seq.current) setIssue(value)
      return value
    } catch (reason) {
      if (mine === seq.current) { setIssue(false); setError(reason instanceof Error ? reason.message : String(reason)) }
      return null
    }
  }, [id])
  useEffect(() => { setIssue(null); setError(null); if (id) reload() }, [id, reload])
  return { issue, error, reload }
}

export default function IssuesPage({ onFocusNode, onOpenSession, specs = [], sessions = [] }) {
  const t = useT()
  const { param, query } = useRoute()
  const text = String(query.q ?? '').trim() || ISSUE_QUERY_DEFAULT
  const page = reviewPageNumber(query.page)
  const list = useReviewPage('issues', text, page, { enabled: !param, refreshKey: sessions })
  const detail = useIssueDetail(param)
  const [notice, setNotice] = useState('')
  const flash = (outcomes) => { if (outcomes) { setNotice(outcomes); setTimeout(() => setNotice(''), 6000) } }
  const onWrite = async (outcomes) => { flash(outcomes); await (param ? detail.reload() : list.reload()) }

  if (param) {
    if (detail.issue == null) return <div className="fv-note">{t('session.issuesLoading')}</div>
    if (detail.error) return <DetailShell failure={detail.error} listHref={routeHash('issues')} listLabel={t('reviewShell.backToIssues')} />
    if (detail.issue === false) {
      // an address naming no issue renders the honest not-found with the list link ([[review-chrome]]).
      return <DetailShell missing={t('reviewShell.issueNotFound', { id: param })} listHref={routeHash('issues')} listLabel={t('reviewShell.backToIssues')} />
    }
    return <IssueDetailPage issue={detail.issue} specs={specs} sessions={sessions} onFocusNode={onFocusNode}
      onOpenSession={onOpenSession} onWrite={onWrite} notice={notice} />
  }
  return <IssuesListPage data={list.data} loading={list.loading} error={list.error} reload={list.reload} specs={specs} sessions={sessions}
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
