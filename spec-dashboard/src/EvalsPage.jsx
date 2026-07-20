import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import EvalsGroup, { currentEntries, entryKey } from './EvalsFeed.jsx'
import EventDetail from './EventDetail.jsx'
import { DetailShell } from './ReviewShell.jsx'
import { EVAL_QUERY_DEFAULT, queryParam, readToken } from './reviewQuery.js'
import { addressHash, detailBackHash, evalAddress, sessionAddress, sessionEvalAddress } from './address.js'
import { navigate, routeHash, useRoute } from './route.js'
import { scenarioStates } from './score.jsx'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { apiUrl } from './project.js'

// The Evals surface ([[evals-view]]): GitHub-style TWO pages over one route family. `#/evals` is the LIST
// page — the [[evals-feed]] rows through the shared [[review-chrome]] ListPage, the whole face ONE token
// query in the URL; `#/evals/<node>/<scenario>` is the standalone DETAIL page — the [[event-detail]]
// workspace in the shared DetailShell. A row click is a real-anchor history PUSH; browser Back restores
// the exact filtered list URL; both pages are directly openable. The `scope:<id>` token scopes EITHER
// page to one session's WORKTREE-rooted model ([[session-eval]] — un-merged evals live here now; the
// detail carries `?q=scope:<id>` alone, and the legacy `#/sessions/<id>/eval` + structured-param
// addresses normalize to this family at the route layer).

// the session scope's worktree-rooted lean model (`GET /api/sessions/:id/evals`, [[session-eval]]) —
// null loading · false genuine 404/none · else the model; transport/5xx failure is a separate loud error.
// A seq guard drops a stale response; `reload` is the write path's refresh (a remark/ok lands in the
// worktree store, which fires no board SSE).
function useSessionEvals(sessionId) {
  const [model, setModel] = useState(null)
  const [error, setError] = useState(null)
  const seq = useRef(0)
  const load = useCallback(() => {
    if (!sessionId) return Promise.resolve()
    const mine = ++seq.current
    setError(null)
    return fetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/evals`))
      .then((r) => (r.ok ? r.json() : r.status === 404 ? false : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((m) => { if (mine === seq.current) setModel(m) })
      .catch((err) => {
        if (mine !== seq.current) return
        setModel(false)
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [sessionId])
  useEffect(() => { setModel(null); setError(null); if (sessionId) load() }, [sessionId, load])
  return { model, error, reload: load }
}

// flatten the session model → the list's rows, the session-eval attention order: blind spots lead
// (declared, never measured — outstanding loss), then the session's own ✦-marked readings, then the
// inherited baseline (other sessions' latest), each newest-first; the ONE latest-per-scenario computation
// (scenarioStates) throughout.
function sessionRows(model) {
  const blind = []
  const own = []
  const inherited = []
  for (const n of model.nodes) {
    for (const s of scenarioStates(n.scenarios, n.evals)) {
      if (!s.reading) { blind.push({ scenario: s.name, expected: s.expected, node: n.id, hue: n.hue }); continue }
      const e = { ...s.reading, expected: s.expected ?? s.reading.expected, state: s.state, node: n.id, hue: n.hue }
      ;(e.inSession ? own : inherited).push(e)
    }
  }
  const byTs = (a, b) => (a.ts < b.ts ? 1 : -1)
  return { blind, entries: [...own.sort(byTs), ...inherited.sort(byTs)] }
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
export function EvalsListPage({ scope, sessionId, model, error, sessions, queryText, onQueryText, hrefFor, notice }) {
  const t = useT()
  const empty = sessionId && model === null
    ? t('common.loading')
    : sessionId && error
      ? t('sessionEval.unavailable')
      : sessionId && model === false
        ? t('sessionEval.none')
        : null
  const leading = sessionId ? (
    // The terminal back door leads the toolbar, before every gate and the trailing export action.
        <div className="se-gates">
          <EvalScopeDoor sessionId={sessionId} />
          {model && model.gates.map((g) => (
            <span key={g.label} className={`se-gate ${g.ok ? 'ok' : 'bad'}`} data-tip={g.detail}><Icon name={g.ok ? 'check' : 'x'} size={11} /> {g.label}</span>
          ))}
          {model && (
            <span className="se-acts">
              <a className="se-export" href={apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/evals?format=html`)} target="_blank" rel="noreferrer" data-tip={t('sessionEval.exportTitle')} aria-label={t('sessionEval.export')}>
                <Icon name="download" size={13} />
              </a>
            </span>
          )}
        </div>
  ) : null
  return (
    <EvalsGroup entries={scope.entries} blind={scope.blind} sessions={sessions}
      queryText={queryText} onQueryText={onQueryText} hrefFor={hrefFor} notice={notice} leading={leading}
      error={error ? t('sessionEval.loadFailed', { reason: error }) : null} empty={empty} />
  )
}

// the Continue-reviewing queue ([[evals-view]]): the viewed reading's NEIGHBORS in the source dataset's
// stable list order, split into two POSITIONAL groups — `prev` holds entries BEFORE the current row,
// `next` entries AFTER it (list direction, never a time claim), each ordered nearest-to-current outward.
// `want` is the default total: split balanced with the forward group taking the odd slot, and a
// boundary's unused budget refills from the other side so the total holds while the dataset allows;
// current excluded, alone-in-dataset yields none. Pure over the entries the page already holds — no
// second fetch, no filter fork, no selection state.
export function queueNeighbors(entries, key, want = 5) {
  const idx = entries.findIndex((e) => entryKey(e) === key)
  if (idx < 0) return { prev: [], next: [] }
  const before = idx
  const after = entries.length - idx - 1
  const take = Math.min(want, before + after)
  const nextN = Math.min(after, Math.max(Math.ceil(take / 2), take - before))
  const prevN = Math.min(before, take - nextN)
  return {
    prev: entries.slice(idx - prevN, idx).reverse(),
    next: entries.slice(idx + 1, idx + 1 + nextN),
  }
}

// The DETAIL page (`#/evals/<node>/<scenario>[?q=scope:<id>]`): the [[event-detail]] workspace for one
// scenario, standalone — directly openable, browser Back the return path. The session scope hands the
// WORKTREE-rooted A/B history down; an address naming no real eval renders the honest not-found.
export function EvalDetailPage({ param, scope, sessionId, model, error, specs, sessions, listHref, backHref, backLabel, onOpenSession, onFocusNode, onWrite, notice }) {
  const t = useT()
  const i = param.indexOf('/')
  const node = i > 0 ? param.slice(0, i) : param
  const scenario = i > 0 ? param.slice(i + 1) : null
  // The session scope's A/B history is WORKTREE-rooted. Memoizing the slice makes its identity stable
  // across unrelated board poll/SSE repaints, so EventDetail keeps the A/B cursor, timeline, and draft.
  const history = useMemo(
    () => (sessionId && model && model !== false
      ? (model.nodes.find((n) => n.id === node)?.evals || []).filter((e) => e.scenario === scenario)
      : undefined),
    [sessionId, model, node, scenario],
  )
  // the queue rows ride the SAME source dataset and the SAME address grammar the list rows use
  // ([[address-routing]]): a trunk neighbor is a pure detail path, a scoped neighbor keeps the one
  // scope token — never list filters.
  const queue = useMemo(() => {
    const row = (e) => ({
      key: entryKey(e),
      node: e.node,
      scenario: e.scenario,
      state: e.state,
      href: addressHash(sessionId ? sessionEvalAddress(sessionId, e.node, e.scenario) : evalAddress(e.node, e.scenario)),
    })
    const n = queueNeighbors(scope.entries, `eval:${node}·${scenario}`)
    return { prev: n.prev.map(row), next: n.next.map(row) }
  }, [scope.entries, node, scenario, sessionId])
  if (sessionId && error) {
    return <DetailShell failure={t('sessionEval.loadFailed', { reason: error })} listHref={listHref} listLabel={t('reviewShell.backToEvals')} />
  }
  if (sessionId && model === null) return <div className="fv-note">{t('common.loading')}</div>
  const entry = scope.entries.find((e) => entryKey(e) === `eval:${node}·${scenario}`) || null
  if (!entry) {
    return <DetailShell missing={t('reviewShell.evalNotFound', { node, scenario: scenario || '' })} listHref={listHref} listLabel={t('reviewShell.backToEvals')} />
  }
  return (
    <div className="page-detail-stack">
      {notice && <div className="fv-notice">{notice}</div>}
      <EventDetail entry={entry} history={history} sourceKey={sessionId || 'project'} specs={specs} sessions={sessions}
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
  const { model, error, reload: reloadSession } = useSessionEvals(sessionId)
  const [notice, setNotice] = useState('')

  // a remark's dispatch echo ([[mentions]], mirrors [[issues-view]]): the write's outcomes summary
  // ('@ new→<session>') flashes as a notice, so an @-dispatch is never silent.
  const flash = (outcomes) => { if (outcomes) { setNotice(outcomes); setTimeout(() => setNotice(''), 6000) } }
  const onWrite = async (outcomes) => {
    flash(outcomes)
    await (sessionId ? reloadSession() : reloadBoard?.())
  }

  const scope = useMemo(
    () => (sessionId ? (model && model !== false ? sessionRows(model) : { blind: [], entries: [] }) : { blind: [], entries: currentEntries(specs) }),
    [sessionId, model, specs],
  )
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

  return param
    ? <EvalDetailPage param={param} scope={scope} sessionId={sessionId} model={model} error={error} specs={specs}
        sessions={sessions} listHref={listHref} backHref={backHref} backLabel={backLabel}
        onOpenSession={onOpenSession} onFocusNode={onFocusNode} onWrite={onWrite} notice={notice} />
    : <EvalsListPage scope={scope} sessionId={sessionId} model={model} error={error} sessions={sessions}
        queryText={query.q || ''} onQueryText={onQueryText} hrefFor={hrefFor} notice={notice} />
}
