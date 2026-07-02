import { useEffect, useRef, useState } from 'react'
import { useT } from './i18n/index.jsx'

// The annotator ([[annotator]]): the human's measuring hand on an ALREADY-captured reading — now the
// issues page's DETAIL PANE for a selected eval (master-detail, [[issues-view]]), no longer a modal: the
// selected reading gets the full pane height instead of a box inside a box. A video reading renders the
// clip with a step ruler (from the step-timeline sidecar: click a step → seek; a drag on the paused frame
// circles a region whose mark is named by the ≤T step); an image renders full-width; a transcript renders
// as text. Output routes through EXISTING seams only: an issue on the responsible node (typed evidence[])
// or a manual@1 reading via the eval seam's POST half. No new ledger structure.

const stepAt = (events, tMs) => { let hit = null; for (const e of events) { if (e.tMs <= tMs) hit = e; else break } return hit }
const mmss = (tMs) => { const s = Math.floor(tMs / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

function Transcript({ hash }) {
  const t = useT()
  const [text, setText] = useState(null)
  useEffect(() => {
    let on = true
    fetch(`/api/yatsu/blob/${hash}`).then((r) => (r.ok ? r.text() : Promise.reject())).then((tx) => { if (on) setText(tx) }).catch(() => { if (on) setText('') })
    return () => { on = false }
  }, [hash])
  return <pre className="eval-transcript">{text ?? t('nodeView.eval.loadingTranscript')}</pre>
}

export default function Annotator({ entry, onFiled }) {
  const t = useT()
  const vid = useRef(null)
  const box = useRef(null)
  const [events, setEvents] = useState([])
  const [marks, setMarks] = useState([])      // { tMs, step, node, rect{x,y,w,h in %}, comment }
  const [drag, setDrag] = useState(null)
  const [verdict, setVerdict] = useState(null)
  const [note, setNote] = useState('')
  const [flash, setFlash] = useState('')
  const kind = entry.blob ? entry.blobKind || 'image' : 'note'   // same honest-kind rule as the feed's kindOf

  // a selection change is a new reading under annotation — the working state belongs to the old one.
  useEffect(() => { setMarks([]); setDrag(null); setVerdict(null); setNote(''); setFlash(''); setEvents([]) }, [entry.blob, entry.scenario, entry.node])

  // the step map arrives lazily from the same blob cache the clip streams from; absent → plain player.
  useEffect(() => {
    if (!entry.timelineBlob || kind !== 'video') return
    let on = true
    fetch(`/api/yatsu/blob/${entry.timelineBlob}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (on && Array.isArray(j?.events)) setEvents(j.events) })
      .catch(() => {})
    return () => { on = false }
  }, [entry.timelineBlob, kind])

  const pct = (ev) => {
    const r = box.current.getBoundingClientRect()
    return { x: ((ev.clientX - r.left) / r.width) * 100, y: ((ev.clientY - r.top) / r.height) * 100 }
  }
  const onDown = (ev) => {
    if (ev.button !== 0) return
    vid.current?.pause()
    const p = pct(ev)
    setDrag({ x0: p.x, y0: p.y, x: p.x, y: p.y })
  }
  const onMove = (ev) => { if (drag) { const p = pct(ev); setDrag({ ...drag, x: p.x, y: p.y }) } }
  const onUp = () => {
    if (!drag) return
    const rect = {
      x: Math.min(drag.x0, drag.x), y: Math.min(drag.y0, drag.y),
      w: Math.abs(drag.x - drag.x0), h: Math.abs(drag.y - drag.y0),
    }
    setDrag(null)
    if (rect.w < 1 && rect.h < 1) return   // a click, not a circle
    const tMs = Math.round((vid.current?.currentTime ?? 0) * 1000)
    const st = stepAt(events, tMs)
    setMarks((m) => [...m, { tMs, step: st?.step ?? null, node: st?.node || entry.node, rect, comment: '' }])
  }
  const setMark = (i, patch) => setMarks((m) => m.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const liveRect = drag && {
    x: Math.min(drag.x0, drag.x), y: Math.min(drag.y0, drag.y),
    w: Math.abs(drag.x - drag.x0), h: Math.abs(drag.y - drag.y0),
  }
  const now = Math.round((vid.current?.currentTime ?? 0) * 1000)

  // save path 1 — an issue on the responsible node(s): the unified Issue port, typed evidence[].
  const fileIssue = async () => {
    const nodes = [...new Set(marks.map((m) => m.node).filter(Boolean))]
    const lines = marks.map((m) =>
      `- ${mmss(m.tMs)}${m.step ? ` · ${m.step}` : ''} · [[${m.node}]] · ${m.comment || '(circled)'} @ ${m.rect.x.toFixed(0)},${m.rect.y.toFixed(0)} ${m.rect.w.toFixed(0)}×${m.rect.h.toFixed(0)}%`)
    const concern = `[video] ${entry.scenario}: ${marks[0]?.comment || t('annotator.reviewFallback')}`
    const r = await fetch('/api/issues', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concern, nodes: nodes.length ? nodes : [entry.node], body: lines.join('\n'),
        evidence: [entry.blob, ...(entry.timelineBlob ? [entry.timelineBlob] : [])],
      }),
    }).catch(() => null)
    setFlash(r?.ok ? t('annotator.issueFiled') : t('annotator.failed'))
    if (r?.ok) onFiled?.()   // the page's issue list refreshes — a filing must show up where it lands
  }

  // save path 2 — a manual@1 reading on THIS scenario (the eval seam), the report as transcript evidence.
  const fileReading = async () => {
    if (!verdict) return
    const transcript = JSON.stringify({ clip: entry.blob, timeline: entry.timelineBlob ?? null, marks }, null, 1)
    const r = await fetch(`/api/specs/${entry.node}/yatsu/eval`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: entry.scenario, status: verdict, note: note || undefined, transcript }),
    }).catch(() => null)
    setFlash(r?.ok ? t('annotator.readingFiled') : t('annotator.failed'))
  }

  return (
    <div className="an-detail">
      <header className="an-head">
        <span className="an-title">{entry.scenario}</span>
        <span className="an-node">{entry.node}</span>
        {entry.evaluator && <span className="an-meta">{entry.evaluator}</span>}
        <span className="an-meta">{new Date(entry.ts).toLocaleString()}</span>
      </header>
      {entry.expected && <div className="an-expected"><b>{t('nodeView.eval.expected')}</b> {entry.expected}</div>}
      {entry.blob != null && entry.verdict?.note && <div className="an-expected an-prior-note"><b>{t('nodeView.eval.noteLabel')}</b> {entry.verdict.note}</div>}

      {entry.blobState === 'present' && kind === 'video' && (
        <>
          <div className="an-stage" ref={box} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}>
            <video className="an-video" ref={vid} src={`/api/yatsu/blob/${entry.blob}`} controls preload="metadata" />
            {marks.map((m, i) => (
              <div key={i} className="an-rect" style={{ left: `${m.rect.x}%`, top: `${m.rect.y}%`, width: `${m.rect.w}%`, height: `${m.rect.h}%` }} />
            ))}
            {liveRect && <div className="an-rect live" style={{ left: `${liveRect.x}%`, top: `${liveRect.y}%`, width: `${liveRect.w}%`, height: `${liveRect.h}%` }} />}
          </div>
          {events.length > 0 && (
            <div className="an-ruler">
              {events.map((e, i) => (
                <button key={i} className={`an-step ${stepAt(events, now) === e ? 'on' : ''}`}
                  onClick={() => { if (vid.current) vid.current.currentTime = e.tMs / 1000 }}
                  title={e.node ? `→ ${e.node}` : undefined}>
                  {mmss(e.tMs)} {e.step}
                </button>
              ))}
            </div>
          )}
          <div className="an-marks">
            {marks.length === 0 && <div className="an-hint">{t('annotator.hint')}</div>}
            {marks.map((m, i) => (
              <div key={i} className="an-mark">
                <span className="an-mark-t">{mmss(m.tMs)}{m.step ? ` · ${m.step}` : ''}</span>
                <input className="an-mark-node" value={m.node} onChange={(ev) => setMark(i, { node: ev.target.value })} title={t('annotator.nodeTitle')} />
                <input className="an-mark-c" value={m.comment} placeholder={t('annotator.commentPh')} onChange={(ev) => setMark(i, { comment: ev.target.value })} />
                <button className="an-mark-x" onClick={() => setMarks((mm) => mm.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
          <footer className="an-actions">
            <button className="an-act" disabled={!marks.length} onClick={fileIssue}>{t('annotator.fileIssue')}</button>
            <span className="an-verdict">
              <button className={`an-v pass ${verdict === 'pass' ? 'on' : ''}`} onClick={() => setVerdict('pass')}>✓ pass</button>
              <button className={`an-v fail ${verdict === 'fail' ? 'on' : ''}`} onClick={() => setVerdict('fail')}>✗ fail</button>
              <input className="an-note" value={note} placeholder={t('annotator.notePh')} onChange={(ev) => setNote(ev.target.value)} />
              <button className="an-act" disabled={!verdict} onClick={fileReading}>{t('annotator.fileReading')}</button>
            </span>
            {flash && <span className="an-flash">{flash}</span>}
          </footer>
        </>
      )}
      {entry.blobState === 'present' && kind === 'image' && (
        <img className="an-image" src={`/api/yatsu/blob/${entry.blob}`} alt={entry.scenario} />
      )}
      {entry.blobState === 'present' && kind === 'transcript' && <Transcript hash={entry.blob} />}
      {entry.blobState === 'miss' && <div className="an-hint">{t('nodeView.eval.miss')}</div>}
      {entry.blobState === 'none' && (entry.verdict?.note
        ? <pre className="eval-transcript">{entry.verdict.note}</pre>
        : <div className="an-hint">{t('nodeView.eval.noImage')}</div>)}
    </div>
  )
}
