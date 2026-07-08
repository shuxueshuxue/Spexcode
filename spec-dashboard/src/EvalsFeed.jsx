import { useEffect, useMemo, useState } from 'react'
import { ScoreBadge, scenarioStates } from './score.jsx'
import { liveSession } from './session.js'
import FilterSelect from './FilterSelect.jsx'
import { useT } from './i18n/index.jsx'

// The evals feed ([[evals-feed]]): the LEFT list of the Evals page (master-detail, [[evals-view]]) — the
// project's CURRENT measured loss. The unit is the SCENARIO, never the reading — latest reading per
// (node, scenario), fresh leading, video first — so the list is bounded by declared scenarios, not by
// measurement count. Rows are title-only; selecting one opens it in the detail pane ([[event-detail]]) —
// media loads THERE, never in the list.
//
// ONE data path, ONE computation: the board nodes arrive as a PROP (the app's single board poll + SSE),
// and latest-per-scenario is score.jsx's scenarioStates — the same vocabulary the node badge, the focus
// panel, and the eval tab use.

const KIND_TAG = { video: 'vid', image: 'img', transcript: 'txt', data: 'data' }

// normalize a reading to its evidence LIST (each {hash, kind, state}): the backend's `evidence` list when
// present, else the legacy scalar (blob + blobKind, absent kind → image) as a one-entry list, else empty —
// the same scalar→list bridge yatsu's evidenceOf does, so a legacy reading still renders.
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

// flatten board nodes → feed entries via the ONE latest-per-scenario computation (scenarioStates).
export function currentEntries(nodes) {
  const out = []
  for (const n of nodes) {
    if (!n.evals?.length) continue
    for (const s of scenarioStates(n.scenarios, n.evals)) {
      if (!s.reading) continue   // a never-measured scenario is the eval tab's blind-spot row, not a feed entry
      out.push({ ...s.reading, expected: s.expected ?? s.reading.expected, state: s.state, node: n.id, hue: n.hue })
    }
  }
  out.sort((a, b) => (a.ts < b.ts ? 1 : -1))
  return out
}

export const entryKey = (e) => `eval:${e.node}·${e.scenario}`

// one eval row — the shared row grammar every eval face uses (the issues page's list here; the session Eval
// tab reuses it verbatim so the two surfaces can never drift apart).
export function EvalRow({ e, selected, onClick }) {
  return (
    <button className={`ef-row ${selected ? 'sel' : ''}`} onClick={onClick}>
      <ScoreBadge state={e.state} />
      {e.inSession && <span className="ef-insession" data-tip="measured by this session">✦</span>}
      <span className="ef-scenario" data-tip={e.scenario}>{e.scenario}</span>
      <span className="ef-node" style={{ color: `hsl(${e.hue ?? 210} 60% 70%)` }}>{e.node}</span>
      <span className="ef-kind">{kindsOf(e).map((k) => KIND_TAG[k]).filter(Boolean).join('·')}</span>
      <span className="ef-time">{rel(e.ts)}</span>
    </button>
  )
}

const rel = (ts) => {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// `nodes`: the board node list, threaded down from the app's one poll. `sel`/`onSel`: the page's single
// selection (the detail pane follows it). `onRows`: reports the VISIBLE entries upward so the page's
// j/k walks this list — filter state stays this group's own. `mustShow`: an entryKey a deep link needs
// visible ([[evals-view]]'s canonical URL) — if the entry exists but the kind filter hides it, the group
// widens ITS OWN filter to 'all' (the filter stays this group's state; the page never reaches in). The
// group carries no title of its own — the [[side-nav]] rail names the Evals page; this list's head is the
// shared two-row cluster: the CONTROL row (`lead` — the shell's anchored fold toggle — beside the kind
// dropdown, the SAME shared control as the issues drain's store filter) over the chip row.
export default function EvalsGroup({ nodes = [], sessions = [], sel, onSel, onRows, mustShow = null, lead = null }) {
  const t = useT()
  const [kind, setKind] = useState(null)          // null = the default: video → image → all, first kind present
  const [liveOnly, setLiveOnly] = useState(false) // [[live-session-filter]]: only readings whose filer is alive

  // latest reading per scenario, already newest-first (currentEntries) — fresh AND stale MIXED, always.
  // Freshness is never a filter here: a stale reading is real measured loss and stays in the time-ordered
  // feed; its row's muted ✓/✗ is the only stale signal.
  const all = useMemo(() => currentEntries(nodes), [nodes])
  const hasVideo = all.some((e) => kindsOf(e).includes('video'))
  const hasImage = all.some((e) => kindsOf(e).includes('image'))
  const effKind = kind ?? (hasVideo ? 'video' : hasImage ? 'image' : 'all')
  // a mixed reading matches EVERY kind it contains; non-media readings (transcript-only, blob-less notes)
  // match no media option and surface under 'all' only.
  const kindRows = useMemo(() => all.filter((e) => effKind === 'all' || kindsOf(e).includes(effKind)), [all, effKind])
  // [[live-session-filter]]: a reading is LIVE while its filer session (e.by) is still alive — the same
  // liveSession join the originator chip renders, so the chip and the dots can never disagree.
  const isLive = (e) => !!liveSession(sessions, e.by)
  const liveCount = useMemo(() => kindRows.filter(isLive).length, [kindRows, sessions])
  const rows = useMemo(() => (liveOnly ? kindRows.filter(isLive) : kindRows), [kindRows, liveOnly, sessions])

  useEffect(() => { onRows?.(rows) }, [rows, onRows])

  // a deep-linked eval hidden by the current filters un-hides itself: widen the kind dropdown to 'all'
  // (and release the live chip) so the canonical URL always renders its eval — but only when the entry
  // actually exists; a bad address changes nothing.
  useEffect(() => {
    if (!mustShow) return
    if (rows.some((e) => entryKey(e) === mustShow)) return
    if (all.some((e) => entryKey(e) === mustShow)) { setKind('all'); setLiveOnly(false) }
  }, [mustShow, rows, all])

  return (
    <section className="fv-group">
      <header className="fv-group-head">
        <span className="fv-head-row">
          {lead}
          <FilterSelect value={effKind} onChange={setKind}
            options={['video', 'image', 'all'].map((k) => ({ value: k, label: t(`evalsFeed.kind.${k}`) }))} />
        </span>
        {/* [[live-session-filter]]: the chip self-hides at N=0 ONLY while the filter is OFF. Once liveOnly
            is on it stays mounted even as liveCount → 0 (the routine case: the live filer worker closes
            after its merge), so the filter is always releasable and the feed never dead-ends empty. */}
        {(liveOnly || liveCount > 0) && (
          <span className="ef-chipbar">
            <button type="button" className={`ef-chip fv-live ${liveOnly ? 'on' : ''}`} onClick={() => setLiveOnly((v) => !v)}
              data-tip={t('masterList.liveChipTitle')}>
              {t('masterList.liveChip', { n: liveCount })}
            </button>
          </span>
        )}
      </header>
      {rows.length === 0 && <div className="ef-empty">{t('evalsFeed.empty')}</div>}
      {rows.map((e) => (
        <EvalRow key={entryKey(e)} e={e} selected={sel === entryKey(e)} onClick={() => onSel(entryKey(e), e)} />
      ))}
    </section>
  )
}
