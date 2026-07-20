import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import EvalsGroup, { entryKey } from './EvalsFeed.jsx'
import EventDetail from './EventDetail.jsx'
import { DetailShell } from './ReviewShell.jsx'
import { EVAL_QUERY_DEFAULT, queryParam, readToken, reviewRouteQuery } from './reviewQuery.js'
import { addressHash, detailBackHash, evalAddress, sessionAddress, sessionEvalAddress } from './address.js'
import { navigate, routeHash, useRoute } from './route.js'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { apiUrl } from './project.js'
import { reviewPageNumber, useReviewPage } from './reviewPage.js'

// The Evals surface ([[evals-view]]): GitHub-style TWO pages over one route family. `#/evals` is the LIST
// page — the [[evals-feed]] rows through the shared [[review-chrome]] ListPage, the whole face ONE token
// query in the URL; `#/evals/<node>/<scenario>` is the standalone DETAIL page — the [[event-detail]]
// workspace in the shared DetailShell. A row click is a real-anchor history PUSH; browser Back restores
// the exact filtered list URL; both pages are directly openable. The `scope:<id>` token scopes EITHER
// page to one session's WORKTREE-rooted model ([[session-eval]] — un-merged evals live here now; the
// detail carries `?q=scope:<id>` alone, and the legacy `#/sessions/<id>/eval` + structured-param
// addresses normalize to this family at the route layer).

// Both source roots use ONE bounded detail request. StrictMode twins join one in-flight request, and a seq
// fence drops an old address response. The scoped response additionally proves it is not older than the
// graph session summary already rendered by the shell.
const detailInflight = new Map()

export function detailMatchesProjection(detail, projection) {
  if (!detail?.evalRevision || !projection?.epoch) return true
  const revision = detail.evalRevision
  if (revision.epoch !== projection.epoch) return false
  if (revision.generation < projection.generation) return false
  if (revision.generation !== projection.generation) return true
  if (projection.revision && revision.content !== projection.revision) return false
  if (projection.value) {
    if (!detail.summary) return false
    const keys = ['measured', 'total', 'pass', 'fail', 'review', 'blind', 'unknown']
    if (keys.some((key) => detail.summary[key] !== projection.value[key])) return false
  }
  return true
}

function fetchEvalDetail(node, scenario, sessionId) {
  const key = `${sessionId || ''}\0${node}\0${scenario}`
  if (detailInflight.has(key)) return detailInflight.get(key)
  const query = new URLSearchParams({ node, scenario })
  if (sessionId) query.set('scope', sessionId)
  const request = fetch(apiUrl(`/api/evals/detail?${query}`), { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : r.status === 404 ? false : Promise.reject(new Error(`HTTP ${r.status}`))))
    .finally(() => detailInflight.delete(key))
  detailInflight.set(key, request)
  return request
}

function useEvalDetail(param, sessionId, projection, enabled = true) {
  const slash = String(param || '').indexOf('/')
  const node = slash > 0 ? param.slice(0, slash) : param
  const scenario = slash > 0 ? param.slice(slash + 1) : ''
  const identity = `${sessionId || ''}\0${node}\0${scenario}`
  const [result, setResult] = useState({ identity: '', data: null, error: null })
  const seq = useRef(0)
  const projectionRef = useRef(projection)
  projectionRef.current = projection
  const load = useCallback(() => {
    if (!enabled || !node || !scenario) return Promise.resolve()
    const mine = ++seq.current
    setResult((current) => current.identity === identity
      ? { ...current, error: null }
      : { identity, data: null, error: null })
    return fetchEvalDetail(node, scenario, sessionId)
      .then(async (value) => {
        if (mine !== seq.current) return
        if (value && !detailMatchesProjection(value, projectionRef.current)) {
          // The graph has already observed a newer generation. One forced re-read joins any concurrent
          // demand read; if it is still stale, fail loud instead of looping or painting old rows.
          const fresh = await fetchEvalDetail(node, scenario, sessionId)
          if (mine !== seq.current) return
          if (fresh && !detailMatchesProjection(fresh, projectionRef.current)) throw new Error('stale session eval detail')
          value = fresh
        }
        setResult({ identity, data: value, error: null })
      })
      .catch((err) => {
        if (mine !== seq.current) return
        const error = err instanceof Error ? err.message : String(err)
        setResult((current) => ({ identity, data: current.identity === identity && current.data ? current.data : false, error }))
      })
  }, [enabled, identity, node, scenario, sessionId])
  useEffect(() => { if (enabled) load() }, [enabled, node, scenario, sessionId, projection?.epoch, projection?.generation, projection?.revision]) // eslint-disable-line react-hooks/exhaustive-deps
  const visible = result.identity === identity ? result : { data: null, error: null }
  return { data: visible.data, error: visible.error, reload: load }
}

// The scoped LIST's one way back to the session terminal ([[evals-view]]): a real icon-only anchor,
// first in the gates toolbar's visual and focus order. Details return here first through their own
// canonical list back anchor; trunk faces and every detail face render no terminal door.
export function EvalScopeDoor({ sessionId }) {
  const t = useT()
  const label = t('sessionEval.scopeDoor')
  return (
    <a className="se-door" href={addressHash(sessionAddress(sessionId))} data-tip={label} aria-label={label}>
      <Icon name="arrow-left" size={16} />
    </a>
  )
}

// The LIST page (`#/evals[?query]`): the session scope's back door + gates strip + export door
// leading the one [[evals-feed]] list INSIDE its shared PageScroll. All filter state is the URL's one token text; the scope: token
// (default absent = the merged trunk) is the door into any session's un-merged worktree evals.
export function EvalsListPage({ sessionId, pageData, loading, error, sessions, queryText, onQueryText, hrefFor, hrefForPage, notice }) {
  const t = useT()
  const unknown = pageData?.unknown || 0
  const empty = sessionId && !loading && !error && (pageData?.sourceTotal ?? 0) === 0 ? t('sessionEval.none') : null
  const leading = sessionId ? (
    // The terminal back door leads the toolbar, before every gate and the trailing export action.
        <div className="se-gates">
          <EvalScopeDoor sessionId={sessionId} />
          {pageData && pageData.gates.map((g) => (
            <span key={g.label} className={`se-gate ${g.ok ? 'ok' : 'bad'}`} data-tip={g.detail}><Icon name={g.ok ? 'check' : 'x'} size={11} /> {g.label}</span>
          ))}
          {unknown > 0 && (
            <span className="se-gate bad" data-tip={t('sessionEval.unknownCoverage', { n: unknown })}>
              <Icon name="info" size={11} /> {unknown}
            </span>
          )}
          {pageData && (
            <span className="se-acts">
              <a className="se-export" href={apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/evals?format=html`)} target="_blank" rel="noreferrer" data-tip={t('sessionEval.exportTitle')} aria-label={t('sessionEval.export')}>
                <Icon name="download" size={13} />
              </a>
            </span>
          )}
        </div>
  ) : null
  return (
    <EvalsGroup pageData={pageData} loading={loading} sessions={sessions}
      queryText={queryText} onQueryText={onQueryText} hrefFor={hrefFor} notice={notice} leading={leading}
      error={error ? t('sessionEval.loadFailed', { reason: error }) : null} empty={empty}
      pagination={pageData ? {
        page: pageData.page, pageCount: pageData.pageCount, prev: pageData.prev, next: pageData.next,
        hrefFor: hrefForPage,
      } : null} />
  )
}

// Continue Reviewing consumes the bounded detail response's positional neighbors. The server owns the
// stable source order and boundary refill; this page only mints their real scoped/trunk anchors.
// The DETAIL page (`#/evals/<node>/<scenario>[?q=scope:<id>]`): the [[event-detail]] workspace for one
// scenario, standalone — directly openable, browser Back the return path. The session scope hands the
// WORKTREE-rooted A/B history down; an address naming no real eval renders the honest not-found.
export function EvalDetailPage({ param, detail, sessionId, loading = false, error, specs, sessions, listHref, backHref, backLabel, onOpenSession, onFocusNode, onWrite, notice }) {
  const t = useT()
  const i = param.indexOf('/')
  const node = i > 0 ? param.slice(0, i) : param
  const scenario = i > 0 ? param.slice(i + 1) : null
  // The server projects the selected scenario's complete history and <=5 lightweight neighbors in the
  // source's stable default order. The browser never needs another scenario's row to build this rail.
  const queue = useMemo(() => {
    const row = (e) => ({
      key: entryKey(e),
      node: e.node,
      scenario: e.scenario,
      state: e.state,
      href: addressHash(sessionId ? sessionEvalAddress(sessionId, e.node, e.scenario) : evalAddress(e.node, e.scenario)),
    })
    const n = detail?.neighbors || { prev: [], next: [] }
    return { prev: n.prev.map(row), next: n.next.map(row) }
  }, [detail?.neighbors, sessionId])
  if (error) {
    return <DetailShell failure={t('sessionEval.loadFailed', { reason: error })} listHref={listHref} listLabel={t('reviewShell.backToEvals')} />
  }
  if (loading) return <div className="fv-note">{t('common.loading')}</div>
  const entry = detail?.selected || null
  if (!entry) {
    return <DetailShell missing={t('reviewShell.evalNotFound', { node, scenario: scenario || '' })} listHref={listHref} listLabel={t('reviewShell.backToEvals')} />
  }
  return (
    <div className="page-detail-stack">
      {notice && <div className="fv-notice">{notice}</div>}
      <EventDetail entry={entry} history={detail.history} sourceKey={sessionId || 'project'} specs={specs} sessions={sessions}
        onOpenSession={onOpenSession} onFocusNode={onFocusNode} onWrite={onWrite} listHref={listHref} backHref={backHref} backLabel={backLabel}
        queue={queue} />
    </div>
  )
}

export default function EvalsPage({ specs = [], sessions = [], reloadBoard, onOpenSession, onFocusNode = null }) {
  const t = useT()
  const { param, query } = useRoute()
  // the worktree DATA-SOURCE axis ([[evals-view]]): the scope: token inside the one q param — never
  // conflated with session:present|missing, the source-session presence facet.
  const sessionId = readToken(query.q || '', 'scope') || null
  const sessionProjection = sessions.find((session) => session.id === sessionId)?.evalSummary || null
  const detail = useEvalDetail(param, sessionId, sessionProjection, !!param)
  const queryText = String(query.q ?? '').trim() || EVAL_QUERY_DEFAULT
  const page = reviewPageNumber(query.page)
  const list = useReviewPage('evals', queryText, page, { enabled: !param, refreshKey: specs })
  const [notice, setNotice] = useState('')

  // a remark's dispatch echo ([[mentions]], mirrors [[issues-view]]): the write's outcomes summary
  // ('@ new→<session>') flashes as a notice, so an @-dispatch is never silent.
  const flash = (outcomes) => { if (outcomes) { setNotice(outcomes); setTimeout(() => setNotice(''), 6000) } }
  const onWrite = async (outcomes) => {
    flash(outcomes)
    await reloadBoard?.()
    await detail.reload()
  }
  // every scoped address on this page is minted by the ONE [[address-routing]] projection — the row/queue
  // detail hrefs (a DETAIL address carries only the scope, never list filters), the way back to the list
  // (the scoped default view, the same text every session door mints — never a scope-only text, which
  // would show both sections and mark no tab active).
  const hrefFor = (e) => addressHash(sessionId ? sessionEvalAddress(sessionId, e.node, e.scenario) : evalAddress(e.node, e.scenario))
  const listHref = sessionId ? addressHash(sessionEvalAddress(sessionId)) : routeHash('evals')
  // the detail chrome's compact back anchor ([[address-routing]]'s return gate, fed only the detail's
  // own canonical scope): a trunk detail returns to the bare #/evals list, a scoped detail to its
  // scoped DEFAULT list — the same address the session doors mint, scope token kept. The scoped list's
  // own first control is the separate route back to the session terminal.
  const backHref = detailBackHash('evals', sessionId)
  const backLabel = t('detail.backToEvals')
  // a human's edit/tab/menu action lands here: PUSH the canonical address — bare for the default view,
  // exactly ?q=<raw text> otherwise ([[review-query]]'s equivalence owns the compare).
  const onQueryText = (text) => navigate('evals', null, { query: queryParam(text, EVAL_QUERY_DEFAULT) })
  const hrefForPage = (target) => routeHash('evals', null, reviewRouteQuery(queryText, EVAL_QUERY_DEFAULT, target))

  return param
    ? <EvalDetailPage param={param} detail={detail.data && detail.data !== false ? detail.data : null} sessionId={sessionId}
        loading={detail.data === null} error={detail.error} specs={specs}
        sessions={sessions} listHref={listHref} backHref={backHref} backLabel={backLabel}
        onOpenSession={onOpenSession} onFocusNode={onFocusNode} onWrite={onWrite} notice={notice} />
    : <EvalsListPage sessionId={sessionId} pageData={list.data} loading={list.loading} error={list.error} sessions={sessions}
        queryText={query.q || ''} onQueryText={onQueryText} hrefFor={hrefFor} hrefForPage={hrefForPage} notice={notice} />
}
