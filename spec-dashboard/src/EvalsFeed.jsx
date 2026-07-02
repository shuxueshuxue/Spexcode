import { useMemo, useState } from 'react'
import { ScoreBadge, readingScore } from './score.jsx'
import { useEscLayer } from './escStack.js'
import Annotator from './Annotator.jsx'
import { useT } from './i18n/index.jsx'

// The evals section ([[evals-feed]]): the project's CURRENT measured loss as a feed. The unit is the
// SCENARIO, never the reading — latest reading per (node, scenario), fresh leading, video first — so the
// feed is bounded by declared scenarios, not by measurement count. Rows are title-only at rest: no media
// request of any kind until a row expands (image thumb) or opens (the annotator owns the only <video>).

const KIND_ICON = { video: '🎬', image: '🖼', transcript: '📄' }
const kindOf = (r) => r.blobKind || 'image'

// flatten board nodes → entries: the FIRST occurrence per scenario in each node's newest-first list is
// its current score (the same latest-per-scenario convention the score badge and the proof use).
function currentEntries(nodes) {
  const out = []
  for (const n of nodes) {
    if (!n.evals?.length) continue
    const seen = new Set()
    for (const r of n.evals) {
      if (seen.has(r.scenario)) continue
      seen.add(r.scenario)
      out.push({ ...r, node: n.id, hue: n.hue })
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

export default function EvalsFeed({ nodes, onClose }) {
  const t = useT()
  useEscLayer(true, onClose)
  const all = useMemo(() => currentEntries(nodes), [nodes])
  const fresh = useMemo(() => all.filter((e) => e.fresh), [all])
  const hasVideo = fresh.some((e) => kindOf(e) === 'video')
  const [kind, setKind] = useState(null)          // null = the default: video, falling back to image
  const [showStale, setShowStale] = useState(false)
  const [open, setOpen] = useState(null)          // expanded row key
  const [annot, setAnnot] = useState(null)        // entry open in the annotator
  const effKind = kind ?? (hasVideo ? 'video' : 'image')
  const pool = showStale ? all : fresh
  const rows = pool.filter((e) => effKind === 'all' || kindOf(e) === effKind)
  const staleN = all.length - fresh.length

  const key = (e) => `${e.node}·${e.scenario}`
  return (
    <div className="ef-overlay" role="dialog" aria-label={t('evalsFeed.title')}>
      <div className="ef-panel">
        <header className="ef-head">
          <span className="ef-title">{t('evalsFeed.title')}</span>
          <span className="ef-chips">
            {['video', 'image', 'all'].map((k) => (
              <button key={k} className={`ef-chip ${effKind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
                {t(`evalsFeed.kind.${k}`)}
              </button>
            ))}
          </span>
          {staleN > 0 && (
            <button className={`ef-chip ef-stale ${showStale ? 'on' : ''}`} onClick={() => setShowStale((v) => !v)}>
              {t('evalsFeed.staleN', { n: staleN })}
            </button>
          )}
          <button className="ef-close" onClick={onClose} title={t('common.close')}>✕</button>
        </header>
        <div className="ef-list">
          {rows.length === 0 && <div className="ef-empty">{t('evalsFeed.empty')}</div>}
          {rows.map((e) => (
            <div key={key(e)} className={`ef-row ${open === key(e) ? 'open' : ''}`}>
              <button className="ef-row-head" onClick={() => setOpen(open === key(e) ? null : key(e))}>
                <ScoreBadge state={readingScore(e)} />
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
      </div>
      {annot && <Annotator entry={annot} onClose={() => setAnnot(null)} />}
    </div>
  )
}
