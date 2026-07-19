import { useMemo } from 'react'
import { ScoreBadge, scenarioStates } from './score.jsx'
import { liveSession } from './session.js'
import FilterSelect from './FilterSelect.jsx'
import { ListPage } from './ReviewShell.jsx'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'

// The evals list ([[evals-feed]]): the rows + filters of the Evals LIST page ([[evals-view]]), rendered
// through the shared [[review-chrome]] ListPage. The unit is the SCENARIO, never the reading — latest
// reading per (node, scenario), fresh AND stale mixed newest-first — so the list is bounded by declared
// scenarios, not by measurement count (and needs no pagination). Rows are one line each and REAL anchors
// to their detail address; media loads only on the detail page.
//
// EVERY filter is URL-query state: the kind dropdown (video | image | all), the live chip, the ok chip —
// the page hands the parsed query down and a human's pick calls onQuery (a history PUSH, GitHub's
// semantics); the list re-derives all of it from the URL on each render, so Back replays exactly.

const KIND_TAG = { video: 'vid', image: 'img', transcript: 'txt', data: 'data' }

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
    <>
      <ScoreBadge state={e.state} />
      {e.inSession && <span className="ef-insession" data-tip={t('evalsFeed.inSession')}>✦</span>}
      <span className="ef-scenario" data-tip={e.scenario}>{e.scenario}</span>
      <span className="ef-node" style={{ color: `hsl(${e.hue ?? 210} 60% 70%)` }}>{e.node}</span>
      <span className="ef-kind">{kindsOf(e).map((k) => KIND_TAG[k]).filter(Boolean).join('·')}</span>
      {e.humanOk && <span role="img" className="ef-okd" data-tip={okdTip} aria-label={okdTip}><Icon name="check" size={11} /></span>}
      <span className="ef-time">{rel(e.ts)}</span>
    </>
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
// `hrefFor`: an entry's detail address. `lead`: extra controls the page owns (the session scope picker).
export default function EvalsGroup({ entries = [], blind = [], sessions = [], query = {}, onQuery, hrefFor, lead = null, notice = null, error = null, empty = null }) {
  const t = useT()
  const hasVideo = entries.some((e) => kindsOf(e).includes('video'))
  const hasImage = entries.some((e) => kindsOf(e).includes('image'))
  const kind = query.kind || (hasVideo ? 'video' : hasImage ? 'image' : 'all')
  const liveOnly = query.live === '1'
  const showOk = query.ok === '1'
  const set = (patch) => onQuery({ ...query, ...patch })

  // a mixed reading matches EVERY kind it contains; non-media readings (transcript-only, blob-less notes)
  // match no media option and surface under 'all' only.
  const kindRows = useMemo(() => entries.filter((e) => kind === 'all' || kindsOf(e).includes(kind)), [entries, kind])
  // [[live-session-filter]]: a reading is LIVE while its filer session (e.by) is still alive — the same
  // liveSession join the filer chip renders, so the chip and the dots can never disagree.
  const isLive = (e) => !!liveSession(sessions, e.by)
  const liveCount = useMemo(() => kindRows.filter(isLive).length, [kindRows, sessions])
  const filtered = liveOnly ? kindRows.filter(isLive) : kindRows
  // [[human-ok]] feed-level triage — the ONE default hide: a scenario whose latest reading is fresh AND
  // human-ok'd is reviewed loss, not current loss. Both release conditions are automatic (a newer reading
  // unbinds the ok; staleness is computed live), and the show-all chip keeps the ok'd set reachable.
  const okHidden = (e) => !!(e.fresh && e.humanOk)
  const okCount = filtered.filter(okHidden).length
  const shown = showOk ? filtered : filtered.filter((e) => !okHidden(e))

  const rows = [
    ...blind.map((b) => ({
      key: `blind:${b.node}·${b.scenario}`,
      cls: 'se-blind',
      content: (
        <>
          <ScoreBadge state="missing" />
          <span className="ef-scenario">{b.scenario}</span>
          <span className="ef-node" style={{ color: `hsl(${b.hue ?? 210} 60% 70%)` }}>{b.node}</span>
          <span className="ef-time">{t('sessionEval.unmeasured')}</span>
        </>
      ),
    })),
    ...shown.map((e) => ({ key: entryKey(e), href: hrefFor(e), content: <EvalRow e={e} /> })),
  ]

  const chips = (liveOnly || liveCount > 0 || showOk || okCount > 0) ? (
    <>
      {/* [[live-session-filter]]: the chip self-hides at N=0 ONLY while the filter is OFF. Once on it
          stays mounted even as liveCount → 0, so the filter is always releasable and the list never
          dead-ends empty. The ok reveal chip follows the same rule. */}
      {(liveOnly || liveCount > 0) && (
        <button type="button" className={`ef-chip fv-live ${liveOnly ? 'on' : ''}`} onClick={() => set({ live: liveOnly ? null : '1' })}
          data-tip={t('masterList.liveChipTitle')}>
          {t('masterList.liveChip', { n: liveCount })}
        </button>
      )}
      {(showOk || okCount > 0) && (
        <button type="button" className={`ef-chip ef-okchip ${showOk ? 'on' : ''}`} onClick={() => set({ ok: showOk ? null : '1' })}
          data-tip={t('evalsFeed.okChipTitle')}>
          <Icon name="check" size={11} />
          {t('evalsFeed.okChip', { n: okCount })}
        </button>
      )}
    </>
  ) : null

  return (
    <ListPage
      notice={notice}
      error={error}
      controls={
        <>
          {lead}
          <FilterSelect value={kind} onChange={(k) => set({ kind: k })}
            options={['video', 'image', 'all'].map((k) => ({ value: k, label: t(`evalsFeed.kind.${k}`) }))} />
        </>
      }
      chips={chips}
      rows={rows}
      empty={empty || t('evalsFeed.empty')}
    />
  )
}
