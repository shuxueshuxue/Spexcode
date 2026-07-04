import { useEffect, useMemo, useState } from 'react'
import { ScoreBadge, scenarioStates } from './score.jsx'
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

const KIND_TAG = { video: 'vid', image: 'img', transcript: 'txt', note: 'note' }

// normalize a reading to its evidence LIST (each {hash, kind, state}): the backend's `evidence` list when
// present, else the legacy scalar (blob + blobKind, absent kind → image) as a one-entry list, else empty —
// the same scalar→list bridge yatsu's evidenceOf does, so a legacy reading still renders.
export const evidenceList = (r) =>
  r.evidence?.length ? r.evidence
  : r.blob != null ? [{ hash: r.blob, kind: r.blobKind || 'image', state: r.blobState || 'present' }]
  : []

// a reading's evidence kinds as a SET (video-first), or ['note'] when it carries no blob at all. Kinds stay
// HONEST: a MIXED reading (images + a video) belongs to EVERY kind it contains — it advertises all its media
// and none it lacks; a blob-less verdict is a 'note', never a media kind.
export const kindsOf = (r) => {
  const ev = evidenceList(r)
  if (!ev.length) return ['note']
  return ['video', 'image', 'transcript'].filter((k) => ev.some((e) => e.kind === k))
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

// one eval row — the shared row grammar every eval face uses (the forum's list here; the session Eval
// tab reuses it verbatim so the two surfaces can never drift apart).
export function EvalRow({ e, selected, onClick }) {
  return (
    <button className={`ef-row ${selected ? 'sel' : ''}`} onClick={onClick}>
      <ScoreBadge state={e.state} />
      {e.inSession && <span className="ef-insession" title="measured by this session">✦</span>}
      <span className="ef-scenario">{e.scenario}</span>
      <span className="ef-node" style={{ color: `hsl(${e.hue ?? 210} 60% 70%)` }}>{e.node}</span>
      <span className="ef-kind">{kindsOf(e).map((k) => KIND_TAG[k]).join('·')}</span>
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
// j/k walks this list — filter state stays this group's own. The group carries no title of its own —
// the [[side-nav]] rail names the Evals page; this list renders just its filter chipbar.
export default function EvalsGroup({ nodes = [], sel, onSel, onRows }) {
  const t = useT()
  const [kind, setKind] = useState(null)          // null = the default: video → image → all, first kind present
  const [showStale, setShowStale] = useState(false)

  const all = useMemo(() => currentEntries(nodes), [nodes])
  const fresh = useMemo(() => all.filter((e) => e.fresh), [all])
  const hasVideo = fresh.some((e) => kindsOf(e).includes('video'))
  const hasImage = fresh.some((e) => kindsOf(e).includes('image'))
  const effKind = kind ?? (hasVideo ? 'video' : hasImage ? 'image' : 'all')
  const pool = showStale ? all : fresh
  // a mixed reading matches EVERY kind it contains, so images+video shows under both the video and image chips.
  const rows = useMemo(() => pool.filter((e) => effKind === 'all' || kindsOf(e).includes(effKind)), [pool, effKind])
  const staleN = all.length - fresh.length

  useEffect(() => { onRows?.(rows) }, [rows, onRows])

  return (
    <section className="fv-group">
      <header className="fv-group-head">
        <span className="ef-chipbar">
          {['video', 'image', 'note', 'all'].map((k) => (
            <button key={k} className={`ef-chip ${effKind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
              {t(`evalsFeed.kind.${k}`)}
            </button>
          ))}
          {staleN > 0 && (
            <button className={`ef-chip ef-stale ${showStale ? 'on' : ''}`} onClick={() => setShowStale((v) => !v)}>
              {t('evalsFeed.staleN', { n: staleN })}
            </button>
          )}
        </span>
      </header>
      {rows.length === 0 && <div className="ef-empty">{t('evalsFeed.empty')}</div>}
      {rows.map((e) => (
        <EvalRow key={entryKey(e)} e={e} selected={sel === entryKey(e)} onClick={() => onSel(entryKey(e), e)} />
      ))}
    </section>
  )
}
