import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import EvalsGroup, { currentEntries, entryKey } from './EvalsFeed.jsx'
import EventDetail from './EventDetail.jsx'
import FilterSelect from './FilterSelect.jsx'
import { DetailShell } from './ReviewShell.jsx'
import { navigate, routeHash, useRoute } from './route.js'
import { scenarioStates } from './score.jsx'
import { sessionHeadline } from './session.js'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { apiUrl } from './project.js'

// The Evals surface ([[evals-view]]): GitHub-style TWO pages over one route family. `#/evals` is the LIST
// page — the [[evals-feed]] rows through the shared [[review-chrome]] ListPage, every filter in the URL
// query; `#/evals/<node>/<scenario>` is the standalone DETAIL page — the [[event-detail]] workspace in the
// shared DetailShell. A row click is a real-anchor history PUSH; browser Back restores the exact filtered
// list URL; both pages are directly openable. The `?session=<id>` query scopes EITHER page to one
// session's WORKTREE-rooted model ([[session-eval]] — un-merged evals live here now; the legacy
// `#/sessions/<id>/eval` address normalizes to this family at the route layer).

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

// The LIST page (`#/evals[?query]`): the session scope's gates strip + export door above the one
// [[evals-feed]] list. All filter state is the URL's; the scope picker (default off = the merged trunk)
// is the easy door into any session's un-merged worktree evals.
export function EvalsListPage({ scope, sessionId, model, error, sessions, query, hrefFor, scopePick, notice }) {
  const t = useT()
  const onQuery = (next) => navigate('evals', null, { query: next })
  const empty = sessionId && model === null
    ? t('common.loading')
    : sessionId && error
      ? t('sessionEval.unavailable')
      : sessionId && model === false
        ? t('sessionEval.none')
        : null
  return (
    <>
      {/* the session scope's gates strip — the same reviewPayload numbers `spex session review` prints
          ([[session-eval]]), plus the self-contained HTML export door. */}
      {sessionId && model && (
        <div className="se-gates">
          {model.gates.map((g) => (
            <span key={g.label} className={`se-gate ${g.ok ? 'ok' : 'bad'}`} data-tip={g.detail}>{g.ok ? '✓' : '✗'} {g.label}</span>
          ))}
          <a className="se-export" href={apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}/evals?format=html`)} target="_blank" rel="noreferrer" data-tip={t('sessionEval.exportTitle')} aria-label={t('sessionEval.export')}>
            <Icon name="download" size={13} />
          </a>
        </div>
      )}
      <EvalsGroup entries={scope.entries} blind={scope.blind} sessions={sessions}
        query={query} onQuery={onQuery} hrefFor={hrefFor} lead={scopePick} notice={notice}
        error={error ? t('sessionEval.loadFailed', { reason: error }) : null} empty={empty} />
    </>
  )
}

// The DETAIL page (`#/evals/<node>/<scenario>[?session=<id>]`): the [[event-detail]] workspace for one
// scenario, standalone — directly openable, browser Back the return path. The session scope hands the
// WORKTREE-rooted A/B history down; an address naming no real eval renders the honest not-found.
export function EvalDetailPage({ param, scope, sessionId, model, error, specs, sessions, listHref, onOpenSession, onWrite, notice }) {
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
  if (sessionId && error) {
    return <DetailShell failure={t('sessionEval.loadFailed', { reason: error })} listHref={listHref} listLabel={t('reviewShell.backToEvals')} />
  }
  if (sessionId && model === null) return <div className="fv-note">{t('common.loading')}</div>
  const entry = scope.entries.find((e) => entryKey(e) === `eval:${node}·${scenario}`) || null
  if (!entry) {
    return <DetailShell missing={t('reviewShell.evalNotFound', { node, scenario: scenario || '' })} listHref={listHref} listLabel={t('reviewShell.backToEvals')} />
  }
  return (
    <div className="lp-page">
      {notice && <div className="fv-notice">{notice}</div>}
      <EventDetail entry={entry} history={history} specs={specs} sessions={sessions}
        onOpenSession={onOpenSession} onWrite={onWrite} listHref={listHref} />
    </div>
  )
}

export default function EvalsPage({ specs = [], sessions = [], reloadBoard, onOpenSession }) {
  const t = useT()
  const { param, query } = useRoute()
  const sessionId = query.session || null
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
  const sessionQ = sessionId ? { session: sessionId } : null
  const hrefFor = (e) => routeHash('evals', `${e.node}/${e.scenario}`, sessionQ)
  const listHref = routeHash('evals', null, sessionQ)

  // the session-scope picker — DEFAULT OFF (the merged trunk), the easy door into any session's un-merged
  // worktree evals ([[session-eval]]). Changing scope drops the kind/live/ok state with it (a new scope is
  // a new list, and its default filters are the honest start).
  const scopePick = (
    <FilterSelect value={sessionId || ''} onChange={(v) => navigate('evals', null, { query: v ? { session: v } : {} })}
      options={[{ value: '', label: t('evals.scopeMerged') },
        ...sessions.map((s) => ({ value: s.id, label: sessionHeadline(s) }))]} />
  )

  return param
    ? <EvalDetailPage param={param} scope={scope} sessionId={sessionId} model={model} error={error} specs={specs}
        sessions={sessions} listHref={listHref} onOpenSession={onOpenSession} onWrite={onWrite} notice={notice} />
    : <EvalsListPage scope={scope} sessionId={sessionId} model={model} error={error} sessions={sessions}
        query={query} hrefFor={hrefFor} scopePick={scopePick} notice={notice} />
}
