import { scenarioStates } from './score.jsx'
import { FacetMenu, FacetOverflow, ListPage, nextQuery, ReviewListRow, ReviewState } from './ReviewShell.jsx'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { sessionHeadline } from './session.js'
import { defaultEvalKind, evalFilterModel, filterMenuGroups, kindsOf } from './reviewFilters.js'

// The evals list ([[evals-feed]]): the rows + filters of the Evals LIST page ([[evals-view]]), rendered
// through the shared [[review-chrome]] ListPage. The unit is the SCENARIO, never the reading — latest
// reading per (node, scenario), fresh AND stale mixed newest-first — so the list is bounded by declared
// scenarios, not by measurement count (and needs no pagination). Rows use the shared two-level ListView
// primitive and remain REAL anchors; media loads only on the detail page. Query, Current/Reviewed section,
// and every real data facet are URL state written as a history PUSH, so Back replays the whole face.

const KIND_TAG = { video: 'vid', image: 'img', transcript: 'txt', data: 'data' }
// flatten board nodes → list entries via the ONE latest-per-scenario computation (scenarioStates).
export function currentEntries(nodes) {
  const out = []
  for (const n of nodes) {
    if (!n.evals?.length) continue
    for (const s of scenarioStates(n.scenarios, n.evals)) {
      if (!s.reading) continue   // a never-measured scenario is the session scope's blind-spot row, not a project entry
      out.push({ ...s.reading, expected: s.expected ?? s.reading.expected, state: s.state, node: n.id, hue: n.hue })
    }
  }
  out.sort((a, b) => (a.ts < b.ts ? 1 : -1))
  return out
}

export const entryKey = (e) => `eval:${e.node}·${e.scenario}`

// one eval row's CONTENT — the shared row grammar ([[review-chrome]] wraps it in the real anchor).
// Human-ok is status-only here: the detail page is the review surface and owns the one write door.
export function EvalRow({ e }) {
  const t = useT()
  const okdTip = e.humanOk && t('evalsFeed.okdTip', {
    by: e.humanOk.by,
    at: new Date(e.humanOk.ts).toLocaleString(),
  })
  return (
    <ReviewListRow
      state={<ReviewState kind="eval" state={e.state} />}
      title={e.scenario}
      meta={(
        <>
          <span className="ef-node" style={{ color: `hsl(${e.hue ?? 210} 60% 70%)` }}>{e.node}</span>
          {e.by && <span>{t('evalsFeed.filedBy', { by: e.by })}</span>}
          <span>{t('evalsFeed.filedAt', { at: rel(e.ts) })}</span>
        </>
      )}
      aside={(
        <>
          {e.inSession && <span className="rl-tag in-session">{t('evalsFeed.sessionTag')}</span>}
          {kindsOf(e).some((k) => KIND_TAG[k]) && <span className="rl-tag">{kindsOf(e).map((k) => KIND_TAG[k]).filter(Boolean).join('·')}</span>}
          {e.humanOk && <span role="img" className="ef-okd" data-tip={okdTip} aria-label={okdTip}><Icon name="check" size={11} /></span>}
        </>
      )}
    />
  )
}

const rel = (ts) => {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// `entries`: the scope's latest-per-scenario rows, newest-first (the page computes them — the project
// scope from the board prop, the session scope from the worktree-rooted model). `blind`: the session
// scope's declared-never-measured scenarios, rendered as INERT leading rows (outstanding loss has no
// reading to open). `query`/`onQuery`: the URL-held filter state and its push writer ([[evals-view]]).
// `hrefFor`: an entry's detail address. Session scope is another real overflow facet over this same model.
export default function EvalsGroup({ entries = [], blind = [], sessions = [], query = {}, onQuery, hrefFor, notice = null, error = null, empty = null }) {
  const t = useT()
  const set = (patch) => onQuery(nextQuery(query, patch))
  const defaultKind = defaultEvalKind(entries)
  const filterItems = [
    ...entries.map((entry, index) => ({ ...entry, reading: true, filterKind: 'reading', filterKey: `reading:${index}`, source: entry })),
    ...blind.map((entry, index) => ({ ...entry, reading: false, filterKind: 'blind', filterKey: `blind:${index}`, source: entry })),
  ]
  const filters = evalFilterModel(filterItems, query, { sessions, t, defaultKind, defaultSection: 'current' })
  const shown = filters.shown.filter((item) => item.filterKind === 'reading').map((item) => item.source)
  const shownBlind = filters.shown.filter((item) => item.filterKind === 'blind').map((item) => item.source)
  const currentCount = filters.sections.current || 0
  const reviewedCount = filters.sections['1'] || 0

  const rows = [
    ...shownBlind.map((b) => ({
      key: `blind:${b.node}·${b.scenario}`,
      cls: 'se-blind',
      content: (
        <ReviewListRow state={<ReviewState kind="eval" state="missing" />} title={b.scenario}
          meta={<><span className="ef-node" style={{ color: `hsl(${b.hue ?? 210} 60% 70%)` }}>{b.node}</span><span>{t('sessionEval.unmeasured')}</span></>} />
      ),
    })),
    ...shown.map((e) => ({ key: entryKey(e), href: hrefFor(e), content: <EvalRow e={e} /> })),
  ]

  const scopeOptions = sessions.length
    ? [{ value: '', label: t('evals.scopeMerged') }, ...sessions.map((session) => ({ value: session.id, label: sessionHeadline(session) }))]
    : []
  const overflowGroups = [
    ...filterMenuGroups(filters, set, ['filer', 'live']),
    { label: t('reviewList.facetScope'), value: query.session || '', active: !!query.session, options: scopeOptions, onChange: (value) => set({ session: value || null }) },
    ...filterMenuGroups(filters, set, ['freshness', 'kind', 'node']).map((group) => ({
      ...group,
      mobileOnly: true,
      onChange: group.key === 'kind' ? (value) => set({ kind: value === defaultKind ? null : value }) : group.onChange,
    })),
  ]
  const verdictFacet = filters.facets.verdict
  const freshnessFacet = filters.facets.freshness
  const kindFacet = filters.facets.kind
  const nodeFacet = filters.facets.node

  return (
    <ListPage
      notice={notice}
      error={error}
      title={t('evalsFeed.title')}
      search={{ value: query.q || '', onSubmit: (value) => set({ q: value || null }), placeholder: t('reviewList.searchEvals'), label: t('reviewList.search') }}
      sections={[
        { key: 'current', label: t('reviewList.current'), count: currentCount, active: filters.state.ok !== '1', onSelect: () => set({ ok: null }) },
        { key: 'reviewed', label: t('reviewList.reviewed'), count: reviewedCount, active: filters.state.ok === '1', onSelect: () => set({ ok: '1' }) },
      ]}
      facets={
        <>
          <FacetMenu label={verdictFacet.label} value={verdictFacet.value} options={verdictFacet.options} clearLabel={t('reviewList.all')} onChange={(value) => set({ verdict: value || null })} mobile />
          <FacetMenu label={freshnessFacet.label} value={freshnessFacet.value} options={freshnessFacet.options} clearLabel={t('reviewList.all')} onChange={(value) => set({ freshness: value || null })} />
          <FacetMenu label={kindFacet.label} value={kindFacet.value} options={kindFacet.options} onChange={(value) => set({ kind: value === defaultKind ? null : value })} />
          <FacetMenu label={nodeFacet.label} value={nodeFacet.value} options={nodeFacet.options} clearLabel={t('reviewList.all')} onChange={(value) => set({ node: value || null })} />
        </>
      }
      overflow={<FacetOverflow label={t('reviewList.moreFilters')} clearLabel={t('reviewList.all')} groups={overflowGroups} />}
      rows={rows}
      empty={empty || {
        hasData: entries.length > 0 || blind.length > 0,
        dataset: t('evalsFeed.datasetEmpty'),
        filtered: t('evalsFeed.noMatches'),
      }}
    />
  )
}
