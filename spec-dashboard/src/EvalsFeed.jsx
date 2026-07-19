import { useMemo } from 'react'
import { scenarioStates } from './score.jsx'
import { sessionHeadline, sessionPresent } from './session.js'
import { FacetMenu, FacetOverflow, ListPage, ReviewListRow, ReviewState } from './ReviewShell.jsx'
import { EVAL_QUERY_DEFAULT, buildMatcher, effectiveTokens, readToken, setToken, tokenize } from './reviewQuery.js'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'

// The evals list ([[evals-feed]]): the rows + filters of the Evals LIST page ([[evals-view]]), rendered
// through the shared [[review-chrome]] ListPage. The unit is the SCENARIO, never the reading — latest
// reading per (node, scenario), fresh AND stale mixed newest-first — so the list is bounded by declared
// scenarios, not by measurement count (and needs no pagination). Rows use the shared two-level ListView
// primitive and remain REAL anchors; media loads only on the detail page. The WHOLE face is ONE visible
// token query ([[review-query]]): sections and low-cardinality menus are pure builders doing token
// surgery + PUSH, node/filer/scope are token-only, and Back replays text + results exactly.

const KIND_TAG = { video: 'vid', image: 'img', transcript: 'txt', data: 'data' }

// the page's recognized qualifier vocabulary — what the highlight overlay colors and the key
// autocomplete offers; anything else stays plain and matches nothing.
export const EVAL_QUERY_KEYS = ['is', 'state', 'verdict', 'freshness', 'evidence', 'node', 'filer', 'session', 'scope']

// normalize a reading to its evidence LIST (each {hash, kind, state}): the backend's `evidence` list when
// present, else the legacy scalar (blob + blobKind, absent kind → image) as a one-entry list, else empty —
// the same scalar→list bridge the eval sidecar's evidenceOf does, so a legacy reading still renders.
export const evidenceList = (r) =>
  r.evidence?.length ? r.evidence
  : r.blob != null ? [{ hash: r.blob, kind: r.blobKind || 'image', state: r.blobState || 'present' }]
  : []

// a reading's evidence kinds as a SET (video-first), or ['note'] when it carries no blob at all. Kinds stay
// HONEST: a MIXED reading (images + a video) belongs to EVERY kind it contains — it advertises all its media
// and none it lacks; a blob-less verdict is a 'note', never a media kind. 'note' is a data-level kind only —
// it is not a filter option and carries no row tag; such readings surface under the 'all' filter.
export const kindsOf = (r) => {
  const ev = evidenceList(r)
  if (!ev.length) return ['note']
  return ['video', 'image', 'transcript', 'data'].filter((k) => ev.some((e) => e.kind === k))
}

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

// Blind spots have scenario/node/query identity and the unscored verdict, but no reading facts. The
// predicate speaks the SAME token language as the reading matcher and stays pure: a blind row can match
// its node, the unscored verdict, the current section, bare words, and the scope pass-through — but any
// evidence/freshness/filer/session-presence/unknown token excludes it, because an unmeasured scenario
// owns none of those reading facts.
export const blindMatchesTokens = (blind, tokens) => effectiveTokens(tokens).every((tk) => (
  tk.key == null
    ? [blind.scenario, blind.node].some((value) => String(value).toLocaleLowerCase().includes(tk.value.toLocaleLowerCase()))
    : tk.key === 'is' ? tk.value === 'eval'
    : tk.key === 'state' ? tk.value === 'current'
    : tk.key === 'scope' ? true
    : tk.key === 'verdict' ? tk.value === 'unscored'
    : tk.key === 'node' ? blind.node === tk.value
    : false
))

// `entries`: the scope's latest-per-scenario rows, newest-first (the page computes them — the project
// scope from the board prop, the session scope from the worktree-rooted model). `blind`: the session
// scope's declared-never-measured scenarios, rendered as INERT leading rows (outstanding loss has no
// reading to open). `queryText`/`onQueryText`: the URL's raw token text and its push writer
// ([[evals-view]] — the writer owns the default↔bare equivalence). `hrefFor`: an entry's detail address.
export default function EvalsGroup({ entries = [], blind = [], sessions = [], queryText = '', onQueryText, hrefFor, notice = null, error = null, empty = null }) {
  const t = useT()
  const text = String(queryText ?? '').trim() || EVAL_QUERY_DEFAULT
  const tokens = useMemo(() => tokenize(text), [text])
  // every control is a BUILDER over the committed text: token surgery, then one history PUSH.
  const surgery = (key, value) => onQueryText(setToken(text, key, value))

  const reviewed = (e) => !!(e.fresh && e.humanOk)
  // [[live-session-filter]]: source-session PRESENCE — the filer session still resolves on the board.
  const isPresent = (e) => !!sessionPresent(sessions, e.by)
  const fields = {
    is: (e, v) => v === 'eval',
    state: (e, v) => (v === 'current' ? !reviewed(e) : v === 'reviewed' ? reviewed(e) : false),
    verdict: (e, v) => (e.verdict?.status || 'unscored') === v,
    freshness: (e, v) => (v === 'fresh' ? e.fresh === true : v === 'stale' ? e.fresh !== true : false),
    evidence: (e, v) => (v === 'all' ? true : kindsOf(e).includes(v)),
    node: (e, v) => e.node === v,
    filer: (e, v) => e.by === v,
    session: (e, v) => (v === 'present' ? isPresent(e) : v === 'missing' ? !isPresent(e) : false),
    scope: () => true,   // scope picks the DATA SOURCE upstream ([[evals-view]]); these rows are already scoped
    $text: (e, w) => [e.scenario, e.node, e.by, e.evaluator].filter(Boolean).some((value) => String(value).toLocaleLowerCase().includes(w)),
  }
  // tab counts are computed under the REST of the query — every token but the section's own state:.
  const restTokens = tokens.filter((tk) => tk.key !== 'state')
  const faceted = useMemo(
    () => entries.filter(buildMatcher(restTokens, fields)),
    [entries, tokens, sessions],
  )
  const currentCount = faceted.filter((e) => !reviewed(e)).length
  const reviewedCount = faceted.filter(reviewed).length
  const shown = entries.filter(buildMatcher(tokens, fields))
  const section = readToken(text, 'state')
  const shownBlind = blind.filter((b) => blindMatchesTokens(b, tokens))
  // the Current tab's COUNT is rest-of-query too: a blind row keeps counting toward Current even while
  // the Reviewed section is displayed — switching tabs must never make the other tab's number jump.
  const blindCount = blind.filter((b) => blindMatchesTokens(b, restTokens)).length

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

  const allOption = { value: '', label: t('reviewList.all') }
  const verdictValue = readToken(text, 'verdict')
  const verdictValues = [...new Set(entries.map((e) => e.verdict?.status || 'unscored'))]
  const verdictOptions = [allOption, ...verdictValues.map((value) => ({ value, label: t(`reviewList.verdict.${value}`) }))]
  const freshnessValue = readToken(text, 'freshness')
  const freshnessValues = [...new Set(entries.map((e) => (e.fresh === true ? 'fresh' : 'stale')))]
  const freshnessOptions = freshnessValues.length > 1
    ? [allOption, ...freshnessValues.map((value) => ({ value, label: t(`reviewList.freshness.${value}`) }))]
    : []
  // the evidence default is `all` — a plain enum with NO data-dependent fallback; All removes the token.
  const evidenceToken = readToken(text, 'evidence')
  const evidenceValue = evidenceToken || 'all'
  const evidenceOptions = [
    { value: 'all', label: t('evalsFeed.kind.all') },
    { value: 'video', label: t('evalsFeed.kind.video') },
    { value: 'image', label: t('evalsFeed.kind.image') },
  ]
  const sessionValue = readToken(text, 'session')
  const sessionOptions = [
    allOption,
    { value: 'present', label: t('reviewList.sessionPresent') },
    { value: 'missing', label: t('reviewList.sessionMissing') },
  ]

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
        { key: 'current', label: t('reviewList.current'), count: currentCount + blindCount, active: section !== 'reviewed', onSelect: () => surgery('state', 'current') },
        { key: 'reviewed', label: t('reviewList.reviewed'), count: reviewedCount, active: section === 'reviewed', onSelect: () => surgery('state', 'reviewed') },
      ]}
      facets={
        <>
          <FacetMenu label={t('reviewList.facetVerdict')} value={verdictValue} options={verdictOptions} clearLabel={allOption.label} onChange={(value) => surgery('verdict', value)} mobile />
          <FacetMenu label={t('reviewList.facetFreshness')} value={freshnessValue} options={freshnessOptions} clearLabel={allOption.label} onChange={(value) => surgery('freshness', value)} />
          <FacetMenu label={t('reviewList.facetKind')} value={evidenceValue} options={evidenceOptions} onChange={(value) => surgery('evidence', value === 'all' ? '' : value)} />
        </>
      }
      overflow={<FacetOverflow label={t('reviewList.moreFilters')} clearLabel={allOption.label} groups={[
        { label: t('reviewList.facetSession'), value: sessionValue, active: !!sessionValue, options: sessionOptions, onChange: (value) => surgery('session', value) },
        { label: t('reviewList.facetFreshness'), value: freshnessValue, active: !!freshnessValue, options: freshnessOptions, onChange: (value) => surgery('freshness', value), mobileOnly: true },
        { label: t('reviewList.facetKind'), value: evidenceValue, active: !!evidenceToken, options: evidenceOptions, clearLabel: null, onChange: (value) => surgery('evidence', value === 'all' ? '' : value), mobileOnly: true },
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
