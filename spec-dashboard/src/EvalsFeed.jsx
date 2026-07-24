import { sessionHeadline } from './session.js'
import { FacetMenu, ListPage, ReviewListRow, ReviewState, SecondaryFilters } from './ReviewShell.jsx'
import { EVAL_QUERY_DEFAULT, readToken, setToken } from './reviewQuery.js'
import { EVAL_FILTER_KIND, kindsOf } from './reviewFilters.js'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'

// The evals list ([[evals-feed]]): the rows + filters of the Evals LIST page ([[evals-view]]), rendered
// through the shared [[review-chrome]] ListPage. The unit is the SCENARIO, never the reading — latest
// reading per (node, scenario), fresh AND stale mixed newest-first. The server returns one 25-row page
// after matching/counting the full declared-scenario population. Rows use the shared two-level ListView
// primitive and remain REAL anchors; media loads only on the detail page. The WHOLE face is ONE visible
// token query ([[review-query]]) bridged into the ONE field-semantics engine ([[review-filters]]):
// sections and low-cardinality menus are pure builders doing token surgery + PUSH, node/filer/scope are
// token-only, and Back replays text + results exactly.

const KIND_TAG = { video: 'vid', image: 'img', transcript: 'txt', data: 'data' }

// the page's recognized qualifier vocabulary — what the highlight overlay colors and the key
// autocomplete offers; anything else stays plain and matches nothing.
export const EVAL_QUERY_KEYS = ['is', 'state', 'verdict', 'freshness', 'evidence', 'node', 'filer', 'session', 'scope']

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

// The paged API supplies latest-per-scenario rows in default order: filed readings newest-first, then
// blind scenarios without a filed time. Blind rows stay INERT, but retain their server position and
// travel through the same filter engine with an honest `unmeasured` verdict.
const optionsOf = (pageData, key, allLabel, labelValue = (value) => value) => (pageData?.facets?.[key]?.options ?? []).map((option) => ({
  value: option.value,
  label: option.value === '' ? allLabel : labelValue(option.value),
}))

export default function EvalsGroup({ pageData, loading = false, sessions = [], queryText = '', onQueryText, hrefFor, notice = null, leading = null, error = null, empty = null, pagination = null }) {
  const t = useT()
  const text = String(queryText ?? '').trim() || EVAL_QUERY_DEFAULT
  // every control is a BUILDER over the committed text: token surgery, then one history PUSH.
  const surgery = (key, value) => onQueryText(setToken(text, key, value))

  const items = Array.isArray(pageData?.items) ? pageData.items : []
  const failCount = pageData?.counts?.fail || 0
  const passCount = pageData?.counts?.pass || 0
  const unmeasuredCount = pageData?.counts?.unmeasured || 0
  const verdict = readToken(text, 'verdict')

  const rows = items.flatMap((item) => {
    if (item.filterKind === EVAL_FILTER_KIND.BLIND) return [{
      key: `blind:${item.node}·${item.scenario}`,
      cls: 'se-blind',
      content: (
        <ReviewListRow state={<ReviewState kind="eval" state="missing" />} title={item.scenario}
          meta={<><span className="ef-node" style={{ color: `hsl(${item.hue ?? 210} 60% 70%)` }}>{item.node}</span><span>{t('sessionEval.unmeasured')}</span></>} />
      ),
    }]
    if (item.filterKind === EVAL_FILTER_KIND.RESULT) {
      return [{ key: entryKey(item), href: hrefFor(item), content: <EvalRow e={item} /> }]
    }
    return []
  })

  // menus are pure query builders over the ADAPTER's data-derived options — zero private state; the
  // evidence default is `all` (a plain enum default, never data-dependent) and All removes the token.
  const reviewFacet = {
    label: t('reviewList.facetReview'), value: readToken(text, 'state'),
    options: optionsOf(pageData, 'review', t('reviewList.all'), (value) => t(value === 'reviewed' ? 'reviewList.reviewed' : 'reviewList.needsReview')),
  }
  const freshnessFacet = {
    label: t('reviewList.facetFreshness'), value: readToken(text, 'freshness'),
    options: optionsOf(pageData, 'freshness', t('reviewList.all'), (value) => t(`reviewList.freshness.${value}`)),
  }
  const kindFacet = {
    label: t('reviewList.facetKind'), value: readToken(text, 'evidence') || 'all',
    options: optionsOf(pageData, 'kind', t('evalsFeed.kind.all'), (value) => t(`evalsFeed.kind.${value}`)),
  }
  const sessionFacet = {
    label: t('reviewList.facetSession'), value: readToken(text, 'session'),
    options: optionsOf(pageData, 'session', t('reviewList.all'), (value) => t(value === 'present' ? 'reviewList.sessionPresent' : 'reviewList.sessionMissing')),
  }
  const evidenceToken = readToken(text, 'evidence')

  return (
    <ListPage
      notice={notice}
      leading={leading}
      error={error}
      loading={loading}
      title={t('evalsFeed.title')}
      search={{
        value: String(queryText ?? '').trim() ? queryText : EVAL_QUERY_DEFAULT,
        onSubmit: onQueryText,
        placeholder: t('reviewList.searchEvals'),
        label: t('reviewList.search'),
        keys: EVAL_QUERY_KEYS,
        // bounded autocomplete candidates: values present in the DATA — and scope, board sessions ONLY.
        suggest: {
          node: optionsOf(pageData, 'node', t('reviewList.all')).filter((option) => option.value),
          filer: optionsOf(pageData, 'filer', t('reviewList.all')).filter((option) => option.value).map(({ value }) => {
            const s = sessions.find((session) => session.id === value)
            return { value, label: s ? sessionHeadline(s) : null }
          }),
          scope: sessions.map((session) => ({ value: session.id, label: sessionHeadline(session) })),
        },
      }}
      sections={[
        // The axis remains non-exhaustive: an unscored/unknown reading is not an unmeasured scenario.
        { key: 'fail', label: <ReviewState kind="eval" state="fail" title={t('reviewList.verdict.fail')} showLabel />, count: failCount, active: verdict === 'fail', onSelect: () => surgery('verdict', verdict === 'fail' ? '' : 'fail') },
        { key: 'pass', label: <ReviewState kind="eval" state="pass" title={t('reviewList.verdict.pass')} showLabel />, count: passCount, active: verdict === 'pass', onSelect: () => surgery('verdict', verdict === 'pass' ? '' : 'pass') },
        { key: 'unmeasured', label: <ReviewState kind="eval" state="missing" title={t('reviewList.verdict.unmeasured')} showLabel />, count: unmeasuredCount, active: verdict === 'unmeasured', onSelect: () => surgery('verdict', verdict === 'unmeasured' ? '' : 'unmeasured') },
      ]}
      sectionMode="filters"
      facets={
        <>
          <FacetMenu label={freshnessFacet.label} value={freshnessFacet.value} options={freshnessFacet.options} clearLabel={t('reviewList.all')} onChange={(value) => surgery('freshness', value)} />
          <FacetMenu label={kindFacet.label} value={kindFacet.value} options={kindFacet.options} onChange={(value) => surgery('evidence', value === 'all' ? '' : value)} />
        </>
      }
      secondaryFilters={<SecondaryFilters label={t('reviewList.filters')} clearLabel={t('reviewList.all')} groups={[
        { label: reviewFacet.label, value: reviewFacet.value, active: !!reviewFacet.value, options: reviewFacet.options, onChange: (value) => surgery('state', value) },
        { label: sessionFacet.label, value: sessionFacet.value, active: !!sessionFacet.value, options: sessionFacet.options, onChange: (value) => surgery('session', value) },
        { label: freshnessFacet.label, value: freshnessFacet.value, active: !!freshnessFacet.value, options: freshnessFacet.options, onChange: (value) => surgery('freshness', value), mobileOnly: true },
        { label: kindFacet.label, value: kindFacet.value, active: !!evidenceToken, options: kindFacet.options, clearLabel: null, onChange: (value) => surgery('evidence', value === 'all' ? '' : value), mobileOnly: true },
      ]} />}
      rows={rows}
      pagination={pagination}
      empty={empty || {
        hasData: (pageData?.sourceTotal ?? 0) > 0,
        dataset: t('evalsFeed.datasetEmpty'),
        filtered: t('evalsFeed.noMatches'),
      }}
    />
  )
}
