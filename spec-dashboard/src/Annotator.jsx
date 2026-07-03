import { useEffect, useRef, useState } from 'react'
import { postIssueReply, postIssueThread, putFrameBlob, specUrl } from './data.js'
import { evidenceList } from './EvalsFeed.jsx'
import { Replies, ReplyComposer, mmss, anchorLine } from './Thread.jsx'
import { useT } from './i18n/index.jsx'

// The annotator ([[annotator]]): the human's measuring hand on an ALREADY-captured reading — the issues
// page's DETAIL PANE for a selected eval (master-detail, [[issues-view]]). A reading's evidence is a LIST:
// the video plays with a step ruler (from the step-timeline sidecar: click a step → seek) AND an image
// gallery renders in the SAME pane (each still click-to-enlarge); a transcript renders as text. There is ONE annotation primitive: a comment on the eval's own Issue thread,
// time-anchored by the `▶m:ss · step` prose convention ([[issues-view]]'s Thread). ⏱ stamps the current
// frame onto a bare note; a drag-circle captures the paused frame to the blob store and prefills an anchored
// comment carrying that frame (image link in the body, hash indexed as the thread's evidence[]) — a mark IS
// thereafter a reply: replyable, @-able (`circle + @new fix this` = a timestamped, framed assign). The
// pass/fail VERDICT stays a separate `manual@1` reading (verdict + note) — it no longer duplicates the marks.

const stepAt = (events, tMs) => { let hit = null; for (const e of events) { if (e.tMs <= tMs) hit = e; else break } return hit }

// click-to-enlarge for an evidence image: a fixed overlay showing the same blob at viewport size —
// click anywhere or Esc closes; Esc is swallowed in capture so the page's own Esc stack never fires.
function ImageLightbox({ src, alt, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="lightbox" onClick={onClose}>
      <img src={src} alt={alt} />
    </div>
  )
}

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

// the deterministic concern key binding an eval's comment thread to its (node, scenario) — the thread IS
// a local Issue, looked up by this exact concern text (ids de-collide, concerns don't).
export const evalConcern = (e) => `eval: ${e.node} · ${e.scenario}`

export default function Annotator({ entry, issues = null, specs = [], sessions = [], onFiled, onWrite }) {
  const t = useT()
  const vid = useRef(null)
  const box = useRef(null)
  const [events, setEvents] = useState([])
  const [drag, setDrag] = useState(null)
  const [verdict, setVerdict] = useState(null)
  const [note, setNote] = useState('')
  const [flash, setFlash] = useState('')
  const [zoom, setZoom] = useState(null)         // an image gallery still opened in the lightbox (its hash), or null
  const [busy, setBusy] = useState(false)       // capturing a circled frame
  const [draft, setDraft] = useState(null)       // { seq, body } — a circle prefills the review-track composer
  const seq = useRef(0)

  // the reading's evidence LIST → its present video (the annotate-a-loop surface) and its still gallery. A
  // legacy scalar reading normalizes to a one-entry list, so an old image/video/transcript still renders.
  const ev = evidenceList(entry)
  const videoEntry = ev.find((e) => e.kind === 'video' && e.state === 'present')
  const images = ev.filter((e) => e.kind === 'image')
  const transcripts = ev.filter((e) => e.kind === 'transcript')
  const hasVideo = !!videoEntry

  // a selection change is a new reading under annotation — the working state belongs to the old one.
  useEffect(() => { setDrag(null); setVerdict(null); setNote(''); setFlash(''); setEvents([]); setZoom(null); setDraft(null) }, [entry.blob, entry.scenario, entry.node])

  // the step map arrives lazily from the same blob cache the clip streams from; absent → plain player.
  useEffect(() => {
    if (!entry.timelineBlob || !hasVideo) return
    let on = true
    fetch(`/api/yatsu/blob/${entry.timelineBlob}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (on && Array.isArray(j?.events)) setEvents(j.events) })
      .catch(() => {})
    return () => { on = false }
  }, [entry.timelineBlob, hasVideo])

  const pct = (ev) => {
    const r = box.current.getBoundingClientRect()
    return { x: ((ev.clientX - r.left) / r.width) * 100, y: ((ev.clientY - r.top) / r.height) * 100 }
  }
  const onDown = (ev) => {
    if (ev.button !== 0 || busy) return
    vid.current?.pause()
    const p = pct(ev)
    setDrag({ x0: p.x, y0: p.y, x: p.x, y: p.y })
  }
  const onMove = (ev) => { if (drag) { const p = pct(ev); setDrag({ ...drag, x: p.x, y: p.y }) } }

  // burn the circled rect into a PNG of the paused frame at natural resolution, stash it in the blob store,
  // and prefill the review-track composer with an anchored comment carrying that frame — the mark becomes a
  // reply. A step whose owning node differs routes the finding there (a `[[node]]` line the reviewer sees).
  const captureCircle = async (rect) => {
    const v = vid.current
    if (!v?.videoWidth) return
    const tMs = Math.round((v.currentTime ?? 0) * 1000)
    const st = stepAt(events, tMs)
    setBusy(true)
    setFlash(t('annotator.capturing'))
    try {
      const cv = document.createElement('canvas')
      cv.width = v.videoWidth; cv.height = v.videoHeight
      const ctx = cv.getContext('2d')
      ctx.drawImage(v, 0, 0, cv.width, cv.height)
      ctx.strokeStyle = '#ff9a3c'; ctx.lineWidth = Math.max(2, cv.width / 300)
      ctx.strokeRect(rect.x / 100 * cv.width, rect.y / 100 * cv.height, rect.w / 100 * cv.width, rect.h / 100 * cv.height)
      const blob = await new Promise((res) => cv.toBlob(res, 'image/png'))
      const { hash } = await putFrameBlob(blob)
      if (!hash) throw new Error('no hash')
      const lines = [anchorLine(tMs, st?.step), `![frame](/api/yatsu/blob/${hash})`]
      if (st?.node && st.node !== entry.node) lines.push(`re: [[${st.node}]]`)
      lines.push('')
      setDraft({ seq: ++seq.current, body: lines.join('\n') })
      setFlash('')
    } catch {
      setFlash(t('annotator.failed'))
    } finally { setBusy(false) }
  }

  const onUp = () => {
    if (!drag) return
    const rect = {
      x: Math.min(drag.x0, drag.x), y: Math.min(drag.y0, drag.y),
      w: Math.abs(drag.x - drag.x0), h: Math.abs(drag.y - drag.y0),
    }
    setDrag(null)
    if (rect.w < 1 && rect.h < 1) return   // a click, not a circle
    captureCircle(rect)
  }
  const liveRect = drag && {
    x: Math.min(drag.x0, drag.x), y: Math.min(drag.y0, drag.y),
    w: Math.abs(drag.x - drag.x0), h: Math.abs(drag.y - drag.y0),
  }
  const now = Math.round((vid.current?.currentTime ?? 0) * 1000)

  // the verdict — a manual@1 reading (verdict + note), the existing eval seam. It no longer carries a marks
  // transcript: the annotation track lives on the eval's Issue thread, not duplicated into a frozen blob.
  const fileReading = async () => {
    if (!verdict) return
    const r = await fetch(specUrl(entry.node, 'yatsu/eval'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: entry.scenario, status: verdict, note: note || undefined }),
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
      {ev.length > 0 && entry.verdict?.note && <div className="an-expected an-prior-note"><b>{t('nodeView.eval.noteLabel')}</b> {entry.verdict.note}</div>}

      {/* the video — the annotate-a-loop surface: circle-to-capture, step ruler, verdict footer */}
      {videoEntry && (
        <>
          <div className="an-stage" ref={box} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}>
            <video className="an-video" ref={vid} src={`/api/yatsu/blob/${videoEntry.hash}`} controls preload="metadata" />
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
          <div className="an-hint">{t('annotator.hint')}</div>
          <footer className="an-actions">
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

      {/* the still gallery — every image entry, each click-to-enlarge; shown beside a video or on its own */}
      {images.length > 0 && (
        <div className="an-gallery" style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '12px 0 0' }}>
          {images.map((e, i) => e.state === 'miss'
            ? <div className="an-hint" key={`${e.hash}-${i}`}>{t('nodeView.eval.miss')}</div>
            : <img className="an-image" key={`${e.hash}-${i}`} src={`/api/yatsu/blob/${e.hash}`} alt={entry.scenario} onClick={() => setZoom(e.hash)} />)}
        </div>
      )}
      {zoom && <ImageLightbox src={`/api/yatsu/blob/${zoom}`} alt={entry.scenario} onClose={() => setZoom(null)} />}

      {transcripts.map((e, i) => e.state === 'miss'
        ? <div className="an-hint" key={`${e.hash}-${i}`}>{t('nodeView.eval.miss')}</div>
        : <Transcript hash={e.hash} key={`${e.hash}-${i}`} />)}

      {ev.length === 0 && (entry.verdict?.note
        ? <pre className="eval-transcript">{entry.verdict.note}</pre>
        : <div className="an-hint">{t('nodeView.eval.noImage')}</div>)}
      {issues && <EvalComments entry={entry} issues={issues} specs={specs} sessions={sessions} onWrite={onWrite}
        vidRef={hasVideo ? vid : null} events={events} draft={draft} />}
    </div>
  )
}

// the eval's REVIEW TRACK — no new object, no new store: the comment thread IS a local Issue lazily bound
// to this (node, scenario) by its concern key. The first comment creates it (the SAME propose the CLI uses,
// nodes:[node]); every later comment replies to it. Anchored comments (`▶m:ss · step`) linkify to their
// video moment (click = seek) and carry their circled frame; sorted by anchor they read as an annotation
// track over the clip. Rendered only where a resident issues list is wired in (the issues page) — the
// lookup needs the list, and posting blind would mint duplicate threads.
function EvalComments({ entry, issues, specs, sessions, onWrite, vidRef, events, draft }) {
  const t = useT()
  const key = evalConcern(entry)
  const thread = issues.find((i) => i.store === 'local' && i.concern === key) || null
  const comments = thread ? [{ by: thread.by, at: thread.created, body: thread.body }, ...(thread.replies || [])] : []
  const send = (text, evidence) => thread
    ? postIssueReply(thread.id, text, evidence)
    : postIssueThread({ concern: key, nodes: [entry.node], body: text, evidence })
  // over a clip: seek from an anchor chip, and stamp the current frame as an anchor from ⏱.
  const onSeek = vidRef ? (tMs) => { if (vidRef.current) vidRef.current.currentTime = tMs / 1000 } : null
  const anchorNow = vidRef ? () => { const tMs = Math.round((vidRef.current?.currentTime ?? 0) * 1000); return { tMs, step: stepAt(events, tMs)?.step ?? null } } : null
  return (
    <section className="an-comments">
      <div className="an-comments-head">{t('annotator.comments', { n: comments.length })}</div>
      <Replies replies={comments} onSeek={onSeek} />
      <ReplyComposer onSend={send} specs={specs} sessions={sessions} focusId={entry.node} onDone={onWrite} anchorNow={anchorNow} draft={draft} />
    </section>
  )
}
