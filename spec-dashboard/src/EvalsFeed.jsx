import { useMemo } from 'react'
import { scenarioStates } from './score.jsx'
import { sessionHeadline } from './session.js'
import { FacetMenu, FacetOverflow, ListPage, ReviewListRow, ReviewState } from './ReviewShell.jsx'
import { EVAL_QUERY_DEFAULT, readToken, setToken } from './reviewQuery.js'
import { evalFilterModel, kindsOf, tokenFilterState } from './reviewFilters.js'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'

// The evals list ([[evals-feed]]): the rows + filters of the Evals LIST page ([[evals-view]]), rendered
// through the shared [[review-chrome]] ListPage. The unit is the SCENARIO, never the reading — latest
// reading per (node, scenario), fresh AND stale mixed newest-first — so the list is bounded by declared
// scenarios, not by measurement count (and needs no pagination). Rows use the shared two-level ListView
// primitive and remain REAL anchors; media loads only on the detail page. The WHOLE face is ONE visible
// token query ([[review-query]]) bridged into the ONE field-semantics engine ([[review-filters]]):
// sections and low-cardinality menus are pure builders doing token surgery + PUSH, node/filer/scope are
// token-only, and Back replays text + results exactly.

const KIND_TAG = { video: 'vid', image: 'img', transcript: 'txt', data: 'data' }

// the page's recognized qualifier vocabulary — what the highlight overlay colors and the key
// autocomplete offers; anything else stays plain and matches nothing.
export const EVAL_QUERY_KEYS = ['is', 'state', 'verdict', 'freshness', 'evidence', 'node', 'filer', 'session', 'scope']

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
// reading to open) — they travel through the SAME engine as reading:false items, so they honestly own
// only their node/unscored/query/section facts. `queryText`/`onQueryText`: the URL's raw token text and
// its push writer ([[evals-view]] — the writer owns the default↔bare equivalence).
export default function EvalsGroup({ entries = [], blind = [], sessions = [], queryText = '', onQueryText, hrefFor, notice = null, error = null, empty = null }) {
  const t = useT()
  const text = String(queryText ?? '').trim() || EVAL_QUERY_DEFAULT
  // every control is a BUILDER over the committed text: token surgery, then one history PUSH.
  const surgery = (key, value) => onQueryText(setToken(text, key, value))

  const filterItems = useMemo(() => [
    ...entries.map((entry) => ({ ...entry, reading: true, filterKind: 'reading', source: entry })),
    ...blind.map((entry) => ({ ...entry, reading: false, filterKind: 'blind', source: entry })),
  ], [entries, blind])
  // ONE parse ([[review-query]]) → ONE matcher ([[review-filters]]): the token text bridges into the
  // engine state; tab counts come out computed under the REST of the query (sections never see their
  // own token), so switching tabs can never make the other tab's number jump.
  const filters = useMemo(
    () => evalFilterModel(filterItems, tokenFilterState(text, 'eval'), { sessions, t, defaultKind: 'all', defaultSection: '' }),
    [filterItems, text, sessions, t],
  )
  const shown = filters.shown.filter((item) => item.filterKind === 'reading').map((item) => item.source)
  const shownBlind = filters.shown.filter((item) => item.filterKind === 'blind').map((item) => item.source)
  const currentCount = filters.sections.current || 0
  const reviewedCount = filters.sections['1'] || 0
  const section = readToken(text, 'state')

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

  // menus are pure query builders over the ADAPTER's data-derived options — zero private state; the
  // evidence default is `all` (a plain enum default, never data-dependent) and All removes the token.
  const verdictFacet = filters.facets.verdict
  const freshnessFacet = filters.facets.freshness
  const kindFacet = filters.facets.kind
  const sessionFacet = filters.facets.session
  const evidenceToken = readToken(text, 'evidence')

  return (
    <ListPage
      notice={notice}
      error={error}
      title={t('evalsFeed.title')}
      search={{
        value: String(queryText ?? '').trim() ? queryText : EVAL_QUERY_DEFAULT,
        onSubmit: onQueryText,
        placeholder: t('reviewList.searchEvals'),
        label: t('reviewList.search'),
        keys: EVAL_QUERY_KEYS,
        // bounded autocomplete candidates: values present in the DATA — and scope, board sessions ONLY.
        suggest: {
          node: [...new Set(entries.map((e) => e.node).filter(Boolean))].map((value) => ({ value })),
          filer: [...new Set(entries.map((e) => e.by).filter(Boolean))].map((value) => {
            const s = sessions.find((session) => session.id === value)
            return { value, label: s ? sessionHeadline(s) : null }
          }),
          scope: sessions.map((session) => ({ value: session.id, label: sessionHeadline(session) })),
        },
      }}
      sections={[
        // Current is the DEFAULT section: with no (or an unknown) state: token it stays the active tab,
        // so the tablist always exposes one roving tab stop and the panel is labelled by a selected tab.
        { key: 'current', label: t('reviewList.current'), count: currentCount, active: section !== 'reviewed', onSelect: () => surgery('state', 'current') },
        { key: 'reviewed', label: t('reviewList.reviewed'), count: reviewedCount, active: section === 'reviewed', onSelect: () => surgery('state', 'reviewed') },
      ]}
      facets={
        <>
          <FacetMenu label={verdictFacet.label} value={verdictFacet.value} options={verdictFacet.options} clearLabel={t('reviewList.all')} onChange={(value) => surgery('verdict', value)} mobile />
          <FacetMenu label={freshnessFacet.label} value={freshnessFacet.value} options={freshnessFacet.options} clearLabel={t('reviewList.all')} onChange={(value) => surgery('freshness', value)} />
          <FacetMenu label={kindFacet.label} value={kindFacet.value} options={kindFacet.options} onChange={(value) => surgery('evidence', value === 'all' ? '' : value)} />
        </>
      }
      overflow={<FacetOverflow label={t('reviewList.moreFilters')} clearLabel={t('reviewList.all')} groups={[
        { label: sessionFacet.label, value: sessionFacet.value, active: !!sessionFacet.value, options: sessionFacet.options, onChange: (value) => surgery('session', value) },
        { label: freshnessFacet.label, value: freshnessFacet.value, active: !!freshnessFacet.value, options: freshnessFacet.options, onChange: (value) => surgery('freshness', value), mobileOnly: true },
        { label: kindFacet.label, value: kindFacet.value, active: !!evidenceToken, options: kindFacet.options, clearLabel: null, onChange: (value) => surgery('evidence', value === 'all' ? '' : value), mobileOnly: true },
      ]} />}
      rows={rows}
      empty={empty || {
        hasData: entries.length > 0 || blind.length > 0,
        dataset: t('evalsFeed.datasetEmpty'),
        filtered: t('evalsFeed.noMatches'),
      }}
    />
  )
}
