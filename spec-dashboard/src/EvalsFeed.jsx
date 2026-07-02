import { useEffect, useMemo, useRef, useState } from 'react'
import { ScoreBadge, scenarioStates } from './score.jsx'
import FeedSection from './FeedSection.jsx'
import Annotator from './Annotator.jsx'
import { useT } from './i18n/index.jsx'

// The evals section ([[evals-feed]]): the issues view's UPPER region — the project's CURRENT measured
// loss as a feed, leading above the threads. The unit is the SCENARIO, never the reading — latest reading
// per (node, scenario), fresh leading, video first — so the feed is bounded by declared scenarios, not by
// measurement count. Rows are title-only at rest: no media request of any kind until a row expands (image
// thumb) or opens (the [[annotator]] owns the only <video>). Wraps itself in the panel's FeedSection so
// the section counts stay internal; [[issues-view]] mounts it as one line above the threads section.
//
// ONE data path, ONE computation: the board nodes arrive as a PROP (the same App-owned board poll + SSE
// every other surface reads — the section fetches nothing of its own), and latest-per-scenario is
// score.jsx's scenarioStates — the same vocabulary the node badge, the focus panel, and the eval tab use.

const KIND_ICON = { video: '🎬', image: '🖼', transcript: '📄' }
const kindOf = (r) => r.blobKind || 'image'

// flatten board nodes → feed entries via the ONE latest-per-scenario computation (scenarioStates).
function currentEntries(nodes) {
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

const rel = (ts) => {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// `nodes` is the board's node list (the panel threads it down from the app's one poll); `focused` is the
// panel's Tab focus ([[issues-view]] owns Tab and passes it down) — forwarded to the FeedSection frame,
// and the gate on this section's own row keys (j/k walk, Enter expands; Enter again on an expanded video
// row opens the annotator).
export default function EvalsSection({ nodes = [], focused = false }) {
  const t = useT()
  const [kind, setKind] = useState(null)          // null = the default: video, falling back to image
  const [showStale, setShowStale] = useState(false)
  const [open, setOpen] = useState(null)          // expanded row key
  const [annot, setAnnot] = useState(null)        // entry open in the annotator
  const [selIdx, setSelIdx] = useState(-1)        // the j/k-walked row; -1 = none

  const all = useMemo(() => currentEntries(nodes), [nodes])
  const fresh = useMemo(() => all.filter((e) => e.fresh), [all])
  const hasVideo = fresh.some((e) => kindOf(e) === 'video')
  const effKind = kind ?? (hasVideo ? 'video' : 'image')
  const pool = showStale ? all : fresh
  const rows = pool.filter((e) => effKind === 'all' || kindOf(e) === effKind)
  const staleN = all.length - fresh.length
  const key = (e) => `${e.node}·${e.scenario}`

  // this region's row keys, live only while the panel focuses it — the threads region's rowsRef pattern
  // (capture phase; a key typed into an input, or while the annotator is above us, is never ours).
  const stateRef = useRef({})
  stateRef.current = { rows, focused, open, annot }
  useEffect(() => {
    const onKey = (e) => {
      const { rows, focused, open, annot } = stateRef.current
      if (!focused || annot) return
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault(); e.stopPropagation()
        if (!rows.length) return
        setSelIdx((i) => {
          const start = i < 0 ? (e.key === 'j' ? -1 : rows.length) : i
          return Math.max(0, Math.min(rows.length - 1, start + (e.key === 'j' ? 1 : -1)))
        })
      } else if (e.key === 'Enter') {
        setSelIdx((i) => {
          const row = rows[i]
          if (!row) return i
          e.preventDefault(); e.stopPropagation()
          const k = `${row.node}·${row.scenario}`
          if (open === k && row.blobState === 'present' && kindOf(row) === 'video') setAnnot(row)
          else setOpen(open === k ? null : k)
          return i
        })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  useEffect(() => {
    if (selIdx >= 0) document.querySelector('.ef-row.kbd-sel')?.scrollIntoView({ block: 'nearest' })
  }, [selIdx])

  return (
    <FeedSection title={t('evalsFeed.title')} summary={t('evalsFeed.summary', { n: rows.length })} density="region" focused={focused}>
      <div className="ef-chipbar">
        {['video', 'image', 'all'].map((k) => (
          <button key={k} className={`ef-chip ${effKind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
            {t(`evalsFeed.kind.${k}`)}
          </button>
        ))}
        {staleN > 0 && (
          <button className={`ef-chip ef-stale ${showStale ? 'on' : ''}`} onClick={() => setShowStale((v) => !v)}>
            {t('evalsFeed.staleN', { n: staleN })}
          </button>
        )}
      </div>
      <div className="ef-list">
        {rows.length === 0 && <div className="ef-empty">{t('evalsFeed.empty')}</div>}
        {rows.map((e, i) => (
          <div key={key(e)} className={`ef-row ${open === key(e) ? 'open' : ''} ${i === selIdx ? 'kbd-sel' : ''}`}>
            <button className="ef-row-head" onClick={() => { setSelIdx(i); setOpen(open === key(e) ? null : key(e)) }}>
              <ScoreBadge state={e.state} />
              <span className="ef-scenario">{e.scenario}</span>
              <span className="ef-node" style={{ color: `hsl(${e.hue ?? 210} 60% 70%)` }}>{e.node}</span>
              <span className="ef-kind">{KIND_ICON[kindOf(e)] ?? '📄'}</span>
              <span className="ef-time">{rel(e.ts)}</span>
            </button>
            {open === key(e) && (
              <div className="ef-detail">
                {e.expected && <div className="ef-expected"><b>{t('nodeView.eval.expected')}</b> {e.expected}</div>}
                {e.verdict?.note && <div className="ef-note">{e.verdict.note}</div>}
                {e.blobState === 'present' && kindOf(e) === 'image' && (
                  <img className="ef-thumb" src={`/api/yatsu/blob/${e.blob}`} loading="lazy" alt={e.scenario} />
                )}
                {e.blobState === 'present' && kindOf(e) === 'video' && (
                  <button className="ef-annotate" onClick={() => setAnnot(e)}>▶ {t('evalsFeed.annotate')}</button>
                )}
                {e.blobState === 'miss' && <div className="ef-miss">{t('nodeView.eval.miss')}</div>}
              </div>
            )}
          </div>
        ))}
      </div>
      {annot && <Annotator entry={annot} onClose={() => setAnnot(null)} />}
    </FeedSection>
  )
}
