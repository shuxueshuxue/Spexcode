import { useMemo } from 'react'
import { scenarioStates } from './score.jsx'
import { liveSession, sessionHeadline } from './session.js'
import { FacetMenu, FacetOverflow, ListPage, nextQuery, ReviewListRow, ReviewState } from './ReviewShell.jsx'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'

// The evals list ([[evals-feed]]): the rows + filters of the Evals LIST page ([[evals-view]]), rendered
// through the shared [[review-chrome]] ListPage. The unit is the SCENARIO, never the reading — latest
// reading per (node, scenario), fresh AND stale mixed newest-first — so the list is bounded by declared
// scenarios, not by measurement count (and needs no pagination). Rows use the shared two-level ListView
// primitive and remain REAL anchors; media loads only on the detail page. Query, Current/Reviewed section,
// and every real data facet are URL state written as a history PUSH, so Back replays the whole face.

const KIND_TAG = { video: 'vid', image: 'img', transcript: 'txt', data: 'data' }
const shortId = (value) => String(value || '').length > 22 ? `${String(value).slice(0, 8)}…` : value

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

// Blind spots have scenario/node/query identity and the unscored verdict, but no reading facts. Keeping
// this predicate pure makes that absence explicit and testable instead of letting inert rows bypass facets.
export const blindMatchesFilters = (blind, { kind, verdict, freshness, node, filer, liveOnly, q }) => (
  kind === 'all'
  && (!verdict || verdict === 'unscored')
  && !freshness
  && (!node || blind.node === node)
  && !filer
  && !liveOnly
  && (!q || [blind.scenario, blind.node].some((value) => String(value).toLocaleLowerCase().includes(q)))
)

// `entries`: the scope's latest-per-scenario rows, newest-first (the page computes them — the project
// scope from the board prop, the session scope from the worktree-rooted model). `blind`: the session
// scope's declared-never-measured scenarios, rendered as INERT leading rows (outstanding loss has no
// reading to open). `query`/`onQuery`: the URL-held filter state and its push writer ([[evals-view]]).
// `hrefFor`: an entry's detail address. Session scope is another real overflow facet over this same model.
export default function EvalsGroup({ entries = [], blind = [], sessions = [], query = {}, onQuery, hrefFor, notice = null, error = null, empty = null }) {
  const t = useT()
  const hasVideo = entries.some((e) => kindsOf(e).includes('video'))
  const hasImage = entries.some((e) => kindsOf(e).includes('image'))
  const kind = ['video', 'image', 'all'].includes(query.kind) ? query.kind : (hasVideo ? 'video' : hasImage ? 'image' : 'all')
  const liveOnly = query.live === '1'
  const reviewedSection = query.ok === '1'
  const q = (query.q || '').trim().toLocaleLowerCase()
  const verdict = query.verdict || ''
  const freshness = query.freshness || ''
  const node = query.node || ''
  const filer = query.filer || ''
  const set = (patch) => onQuery(nextQuery(query, patch))

  // [[live-session-filter]]: a reading is LIVE while its filer session (e.by) is still alive — the same
  // liveSession join the filer chip renders, so the facet and the dots can never disagree.
  const isLive = (e) => !!liveSession(sessions, e.by)
  const verdictOf = (e) => e.verdict?.status || 'unscored'
  const reviewed = (e) => !!(e.fresh && e.humanOk)
  const matches = (e) => (
    (kind === 'all' || kindsOf(e).includes(kind))
    && (!verdict || verdictOf(e) === verdict)
    && (!freshness || (freshness === 'fresh' ? e.fresh === true : e.fresh !== true))
    && (!node || e.node === node)
    && (!filer || e.by === filer)
    && (!liveOnly || isLive(e))
    && (!q || [e.scenario, e.node, e.by, e.evaluator].filter(Boolean).some((value) => String(value).toLocaleLowerCase().includes(q)))
  )
  const faceted = useMemo(() => entries.filter(matches), [entries, kind, verdict, freshness, node, filer, liveOnly, q, sessions])
  const currentCount = faceted.filter((e) => !reviewed(e)).length
  const reviewedCount = faceted.filter(reviewed).length
  const shown = faceted.filter((e) => reviewed(e) === reviewedSection)

  const shownBlind = reviewedSection ? [] : blind.filter((b) => blindMatchesFilters(b, {
    kind, verdict, freshness, node, filer, liveOnly, q,
  }))

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
  const verdictValues = [...new Set(entries.map(verdictOf))]
  const verdictOptions = [allOption, ...verdictValues.map((value) => ({ value, label: t(`reviewList.verdict.${value}`) }))]
  const freshnessValues = [...new Set(entries.map((e) => (e.fresh === true ? 'fresh' : 'stale')))]
  const freshnessOptions = freshnessValues.length > 1
    ? [allOption, ...freshnessValues.map((value) => ({ value, label: t(`reviewList.freshness.${value}`) }))]
    : []
  const nodeValues = [...new Set(entries.map((e) => e.node).filter(Boolean))]
  const nodeOptions = nodeValues.length > 1 ? [allOption, ...nodeValues.map((value) => ({ value, label: value }))] : []
  const filerValues = [...new Set(entries.map((e) => e.by).filter(Boolean))]
  const filerOptions = filerValues.length ? [allOption, ...filerValues.map((value) => ({
    value,
    label: sessions.find((session) => session.id === value) ? sessionHeadline(sessions.find((session) => session.id === value)) : shortId(value),
  }))] : []
  const scopeOptions = sessions.length
    ? [{ value: '', label: t('evals.scopeMerged') }, ...sessions.map((session) => ({ value: session.id, label: sessionHeadline(session) }))]
    : []
  const liveCount = entries.filter(isLive).length
  const liveOptions = (liveOnly || liveCount > 0) ? [allOption, { value: '1', label: t('reviewList.live') }] : []
  const kindOptions = [
    { value: 'all', label: t('evalsFeed.kind.all') },
    { value: 'video', label: t('evalsFeed.kind.video') },
    { value: 'image', label: t('evalsFeed.kind.image') },
  ]

  return (
    <ListPage
      notice={notice}
      error={error}
      title={t('evalsFeed.title')}
      search={{ value: query.q || '', onSubmit: (value) => set({ q: value || null }), placeholder: t('reviewList.searchEvals'), label: t('reviewList.search') }}
      sections={[
        { key: 'current', label: t('reviewList.current'), count: currentCount + shownBlind.length, active: !reviewedSection, onSelect: () => set({ ok: null }) },
        { key: 'reviewed', label: t('reviewList.reviewed'), count: reviewedCount, active: reviewedSection, onSelect: () => set({ ok: '1' }) },
      ]}
      facets={
        <>
          <FacetMenu label={t('reviewList.facetVerdict')} value={verdict} options={verdictOptions} onChange={(value) => set({ verdict: value || null })} mobile />
          <FacetMenu label={t('reviewList.facetFreshness')} value={freshness} options={freshnessOptions} onChange={(value) => set({ freshness: value || null })} />
          <FacetMenu label={t('reviewList.facetKind')} value={kind} options={kindOptions} onChange={(value) => set({ kind: value === (hasVideo ? 'video' : hasImage ? 'image' : 'all') ? null : value })} />
          <FacetMenu label={t('reviewList.facetNode')} value={node} options={nodeOptions} onChange={(value) => set({ node: value || null })} />
        </>
      }
      overflow={<FacetOverflow label={t('reviewList.moreFilters')} groups={[
        { label: t('reviewList.facetFiler'), value: filer, options: filerOptions, onChange: (value) => set({ filer: value || null }) },
        { label: t('reviewList.facetScope'), value: query.session || '', options: scopeOptions, onChange: (value) => set({ session: value || null }) },
        { label: t('reviewList.facetLive'), value: liveOnly ? '1' : '', options: liveOptions, onChange: (value) => set({ live: value || null }) },
        { label: t('reviewList.facetFreshness'), value: freshness, options: freshnessOptions, onChange: (value) => set({ freshness: value || null }), mobileOnly: true },
        { label: t('reviewList.facetKind'), value: kind, options: kindOptions, onChange: (value) => set({ kind: value === (hasVideo ? 'video' : hasImage ? 'image' : 'all') ? null : value }), mobileOnly: true },
        { label: t('reviewList.facetNode'), value: node, options: nodeOptions, onChange: (value) => set({ node: value || null }), mobileOnly: true },
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
