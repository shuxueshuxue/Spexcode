import { useCallback, useEffect, useRef, useState } from 'react'
import { postRemark, putFrameBlob, specUrl } from './data.js'
import { evidenceList } from './EvalsFeed.jsx'
import { EvidenceItem, FullscreenButton } from './Evidence.jsx'
import { Replies, ReplyComposer, OriginatorLiveness, mmss, anchorLine, parseAnchor, resolveAnchor } from './Thread.jsx'
import { useT } from './i18n/index.jsx'

// EventDetail ([[event-detail]], U1): the ONE evidence+reply detail pane, store-agnostic, reused in every
// home — the Evals page AND the session eval tab. It renders a selected READING (an "event") as a
// WORKSPACE, not a scroll stack: a slim HEADER (title · node · verdict badge · the A/B strip), then a
// center MEDIA STAGE beside an always-visible RIGHT RAIL. The stage: a reading's evidence is a LIST — the
// video plays under a CUSTOM review-track scrubber (native chrome replaced so the timeline can carry the
// review) — anchored remarks render as MARKERS on the scrubber, the playhead lights the remark it is
// inside, clicking a marker/remark seeks; a step-timeline sidecar bands the step boundaries + names the
// live step, and the named-step ruler under it click-seeks. The whole surface is keyboard-driven (space,
// arrows, ,/. frame-fine, ↑/↓ jump remarks, a = annotate the current frame). An image gallery renders on
// the SAME stage (each still click-to-enlarge); a transcript renders as text. The RAIL carries the remark
// track (the anchored list, click-to-seek) over a composer DOCKED at its foot — circle on the stage,
// remark in the rail, media never scrolling out of view (the gugu-annotator shape; no vertical ping-pong).
//
// There is ONE reply primitive: a REMARK on the eval's own (node, scenario) thread ([[remark-substrate]]) —
// a scenario-scoped concern is a remark, never an issue (I1). It is time-anchored by the `▶m:ss · step`
// prose convention ([[issues-view]]'s Thread); ⏱/a stamps the current frame onto a note; a drag-circle
// captures the paused frame and prefills an anchored remark carrying it. A remark's `resolved` bit renders in
// the thread (settled when resolved, prominent while open). The composer authors through the CLI-parity
// /api/remarks (L: the dashboard is a thin wrapper, no dashboard-only write). The pane READS readings and
// hosts remarks — it never files a reading: verdicts land through the CLI eval seam (`spex yatsu eval`,
// [[yatsu-core]]) with evidence, and render here as the header badge + A/B pips.
//
// A/B history ([[reproduce-before-fix]]): a scenario's readings are its lifecycle, and a bug fix leaves a
// fail→pass PAIR — the A (reproduced bug) and the B (verified fix). The pane flips through that whole
// per-scenario history (verdict pips + ‹ › nav), swapping the media in place, so the error→correct
// transition is right here, not just the latest reading.

const stepAt = (events, tMs) => { let hit = null; for (const e of events) { if (e.tMs <= tMs) hit = e; else break } return hit }

// verdict pip for the A/B history strip: ✓ pass (a B pole) / ✗ fail (an A pole) / · a pre-verdict legacy
// reading. The verdict is an object `{status, note}` (never a bare string), so read `.status`.
const verdictMark = (r) => (r.verdict?.status === 'pass' ? '✓' : r.verdict?.status === 'fail' ? '✗' : '·')
const verdictCls = (r) => (r.verdict?.status === 'pass' ? 'pass' : r.verdict?.status === 'fail' ? 'fail' : 'legacy')

// the deterministic concern key binding an eval's remark thread to its (node, scenario) — the thread IS a
// local Issue, keyed by this exact concern text (ids de-collide, concerns don't). Kept only for display /
// marker lookup; the WRITE side never needs it (the /api/remarks host is (node, scenario), find-or-create).
export const evalConcern = (e) => `eval: ${e.node} · ${e.scenario}`

export default function EventDetail({ entry, specs = [], sessions = [], onWrite }) {
  const t = useT()
  const vid = useRef(null)
  const box = useRef(null)
  const seekRef = useRef(null)
  const playerRef = useRef(null)   // the video+controls wrapper — the fullscreen target (controls stay usable)
  const seq = useRef(0)
  const [events, setEvents] = useState([])
  const [drag, setDrag] = useState(null)
  const [flash, setFlash] = useState('')         // circle-capture feedback (capturing… / failed)
  const [busy, setBusy] = useState(false)       // capturing a circled frame
  const [draft, setDraft] = useState(null)       // { seq, body } — a circle / `a` prefills the review-track composer
  // custom-player state: the playhead owns the review track now that native chrome is gone.
  const [cur, setCur] = useState(0)              // current time, seconds
  const [dur, setDur] = useState(0)              // duration, seconds
  const [playing, setPlaying] = useState(false)
  const [seeking, setSeeking] = useState(false)  // dragging the scrubber
  const [hoverPct, setHoverPct] = useState(null) // scrubber hover preview, 0..100 or null
  const [selIdx, setSelIdx] = useState(null)     // index (into comments) of the explicitly-selected comment

  // A/B history: this scenario's WHOLE reading history (newest-first), lazily fetched from the same
  // /api/specs/:id/evals timeline the eval tab uses — the board only folds the LATEST reading per scenario
  // ([[board-lean]]), so walking the fail→pass poles needs this one extra read. `histIdx` indexes that list
  // (0 = the latest, i.e. the `entry` the feed selected); `viewing` is the reading actually shown — the
  // entry until history lands, then the picked reading.
  const [history, setHistory] = useState(null)
  const [histIdx, setHistIdx] = useState(0)
  const viewing = (history && history[histIdx]) || entry

  // a selection change is a new SCENARIO under annotation — reset the working state AND the history cursor,
  // then refetch this scenario's slice of the node's timeline.
  useEffect(() => {
    setDrag(null); setFlash(''); setEvents([]); setDraft(null)
    setHistIdx(0); setHistory(null)
    let on = true
    fetch(specUrl(entry.node, 'evals'))
      .then((r) => (r.ok ? r.json() : null))
      .then((tl) => { if (on && Array.isArray(tl?.readings)) setHistory(tl.readings.filter((r) => r.scenario === entry.scenario)) })
      .catch(() => {})
    return () => { on = false }
  }, [entry.node, entry.scenario, entry.ts, entry.blob])

  // flipping A/B changes the clip/stills under the pen — drop any in-progress mark or draft.
  useEffect(() => { setDrag(null); setDraft(null) }, [histIdx])

  // the reading's evidence LIST → its present video (the annotate-a-loop surface) and its still gallery, for
  // the CURRENTLY-VIEWED reading. A legacy scalar reading normalizes to a one-entry list, so an old
  // image/video/transcript still renders.
  const ev = evidenceList(viewing)
  const videoEntry = ev.find((e) => e.kind === 'video' && e.state === 'present')
  const images = ev.filter((e) => e.kind === 'image')
  const transcripts = ev.filter((e) => e.kind === 'transcript')
  const hasVideo = !!videoEntry

  // the eval's remark track rides the reading as `entry.thread` — the ONE server-side (node,scenario)↔thread
  // overlay ([[remark-teeth]] / [[eval-issue-split]]), the SAME on BOTH homes (the issues-page feed folds it
  // in through the board; the session tab through the proof model), so this pane no longer re-matches a
  // concern against a resident issues list. Computed here (not just in the comments section) so the scrubber
  // can render each anchored remark as a marker and the keyboard can jump between them.
  const thread = entry.thread ?? null
  const comments = thread ? [{ by: thread.by, at: thread.created, body: thread.body }, ...(thread.replies || [])] : []
  // the eval's ORIGINATOR ([[mentions]] loop-in) — the session that FILED this scenario's reading, which is
  // the courtesy target an un-@'d remark reaches. The chain's first link is the LATEST reading's filer, so
  // read it from the newest history row (history is newest-first), falling back to the viewed reading; a
  // legacy reading without `by` yields nothing and the header simply shows no originator.
  const filer = (history && history[0]?.by) || entry.by || null
  // the anchored subset, carrying each comment's index into `comments` and its moment — sorted by moment.
  // E2: the moment is resolved by STEP-NAME against THIS reading's timeline (resolveAnchor), so a marker sits
  // where the step actually is in the current clip, not at a frozen m:ss. A degraded anchor (its step gone
  // from the timeline) can't be reliably placed, so it drops off the scrubber — it still lists in the thread
  // as a readable-not-seekable chip.
  const anchored = comments
    .map((c, i) => { const ra = resolveAnchor(parseAnchor(c.body), events); return ra && ra.seekable ? { i, tMs: ra.tMs, step: ra.step, label: ra.label } : null })
    .filter(Boolean)
    .sort((x, y) => x.tMs - y.tMs)

  // a selection change is a new reading — reset the player-specific state (the shared working state + the
  // A/B history cursor are reset by the history effect above).
  useEffect(() => {
    setCur(0); setDur(0); setPlaying(false); setSeeking(false); setHoverPct(null); setSelIdx(null)
  }, [entry.blob, entry.scenario, entry.node])

  // the step map arrives lazily from the same blob cache the clip streams from; reset then (re)load on the
  // viewed reading — absent timeline/video → plain player.
  useEffect(() => {
    setEvents([])
    if (!viewing.timelineBlob || !hasVideo) return
    let on = true
    fetch(`/api/yatsu/blob/${viewing.timelineBlob}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (on && Array.isArray(j?.events)) setEvents(j.events) })
      .catch(() => {})
    return () => { on = false }
  }, [viewing.timelineBlob, hasVideo])

  // the playhead follows the media element — timeupdate (~4Hz) + seeked keep the track live; play/pause keep
  // the toggle honest. The fill/knob CSS transition smooths the coarse ticks. No rAF loop: the review track
  // re-parses comment markdown on every render, so a 60Hz playhead would burn it for no reviewer-visible gain.
  useEffect(() => {
    const v = vid.current
    if (!v) return
    const onTime = () => setCur(v.currentTime || 0)
    const onMeta = () => setDur(v.duration || 0)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('seeked', onTime)
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('durationchange', onMeta)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    return () => {
      v.removeEventListener('timeupdate', onTime); v.removeEventListener('seeked', onTime)
      v.removeEventListener('loadedmetadata', onMeta); v.removeEventListener('durationchange', onMeta)
      v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause)
    }
  }, [videoEntry?.hash])

  const curMs = Math.round(cur * 1000)
  const durMs = Math.round(dur * 1000)
  const playPct = durMs ? (curMs / durMs) * 100 : 0
  const activeStep = stepAt(events, curMs)
  // the comment the playhead is currently inside = the last anchored comment at or before now.
  let activeIdx = null
  for (const a of anchored) { if (a.tMs <= curMs) activeIdx = a.i; else break }

  const seekMs = useCallback((tMs) => { const v = vid.current; if (v) v.currentTime = tMs / 1000 }, [])
  const togglePlay = useCallback(() => { const v = vid.current; if (v) (v.paused ? v.play() : v.pause()) }, [])
  const selectComment = (i, tMs) => { setSelIdx(i); if (tMs != null) seekMs(tMs) }
  // ⏱ stamps the frame the playhead is on — the current time + the step it is inside.
  const anchorNow = useCallback(() => { const tMs = Math.round((vid.current?.currentTime ?? 0) * 1000); return { tMs, step: stepAt(events, tMs)?.step ?? null } }, [events])

  // annotate the current frame from the keyboard (`a`): stamp its anchor into the composer, ready to type —
  // the same start-a-comment path a circle takes, minus the frame image. Routes to the step's node when set.
  const annotateFrame = useCallback(() => {
    const v = vid.current
    if (!v) return
    v.pause()
    const tMs = Math.round((v.currentTime || 0) * 1000)
    const st = stepAt(events, tMs)
    const lines = [anchorLine(tMs, st?.step)]
    if (st?.node && st.node !== entry.node) lines.push(`re: [[${st.node}]]`)
    lines.push('')
    setDraft({ seq: ++seq.current, body: lines.join('\n') })
  }, [events, entry.node])

  // ↑/↓ jump to the previous/next anchored comment (seek + select); with none selected, seed from the
  // comment the playhead is currently inside so the walk starts where the reviewer is looking.
  const jumpAnchor = useCallback((dir) => {
    if (!anchored.length) return
    let pos = anchored.findIndex((a) => a.i === selIdx)
    if (pos < 0) {
      const nowMs = Math.round((vid.current?.currentTime || 0) * 1000)
      pos = anchored.reduce((acc, a, idx) => (a.tMs <= nowMs ? idx : acc), -1)
    }
    pos = Math.min(anchored.length - 1, Math.max(0, pos + dir))
    const a = anchored[pos]
    setSelIdx(a.i); seekMs(a.tMs)
  }, [anchored, selIdx, seekMs])

  // the whole player is keyboard-driven; typing in a field (the composer) is never hijacked.
  useEffect(() => {
    if (!hasVideo) return
    const onKey = (e) => {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      const v = vid.current
      if (!v) return
      if (e.key === ' ') { e.preventDefault(); togglePlay() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); v.currentTime = Math.min(v.duration || v.currentTime, v.currentTime + (e.shiftKey ? 1 : 5)) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - (e.shiftKey ? 1 : 5)) }
      else if (e.key === ',') { e.preventDefault(); v.currentTime = Math.max(0, v.currentTime - 1 / 30) }
      else if (e.key === '.') { e.preventDefault(); if (v.duration) v.currentTime = Math.min(v.duration, v.currentTime + 1 / 30) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); jumpAnchor(1) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); jumpAnchor(-1) }
      else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); annotateFrame() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasVideo, togglePlay, jumpAnchor, annotateFrame])

  // scrubber: click / drag anywhere to seek; hovering previews the moment under the cursor.
  const seekToX = (clientX) => {
    const r = seekRef.current?.getBoundingClientRect(); const v = vid.current
    if (!r || !r.width || !v || !v.duration) return
    v.currentTime = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * v.duration
  }
  const onSeekDown = (e) => { e.preventDefault(); setSeeking(true); seekToX(e.clientX) }
  const onSeekHover = (e) => { const r = seekRef.current?.getBoundingClientRect(); if (r?.width) setHoverPct(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))) }
  useEffect(() => {
    if (!seeking) return
    const mv = (e) => seekToX(e.clientX)
    const up = () => setSeeking(false)
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up) }
  }, [seeking])

  const pct = (ev) => {
    const r = box.current.getBoundingClientRect()
    return { x: ((ev.clientX - r.left) / r.width) * 100, y: ((ev.clientY - r.top) / r.height) * 100 }
  }
  // over the frame: a plain click toggles play/pause; a drag circles a problem region (the video pauses the
  // moment it becomes a real drag, so the circled frame is frozen).
  const onDown = (ev) => {
    if (ev.button !== 0 || busy) return
    const p = pct(ev)
    setDrag({ x0: p.x, y0: p.y, x: p.x, y: p.y })
  }
  const onMove = (ev) => {
    if (!drag) return
    const p = pct(ev)
    if (!vid.current?.paused && (Math.abs(p.x - drag.x0) > 1 || Math.abs(p.y - drag.y0) > 1)) vid.current?.pause()
    setDrag({ ...drag, x: p.x, y: p.y })
  }

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
    if (rect.w < 1 && rect.h < 1) { togglePlay(); return }   // a click, not a circle → play/pause
    captureCircle(rect)
  }
  const liveRect = drag && {
    x: Math.min(drag.x0, drag.x), y: Math.min(drag.y0, drag.y),
    w: Math.abs(drag.x - drag.x0), h: Math.abs(drag.y - drag.y0),
  }

  return (
    <div className="an-detail">
      {/* the slim header — identity + verdict + the A/B strip, one row band over the workspace */}
      <header className="an-head">
        <span className="an-title">{entry.scenario}</span>
        <span className="an-node">{entry.node}</span>
        <span className={`an-verdict-badge ${verdictCls(viewing)}`}>{verdictMark(viewing)}</span>
        {viewing.evaluator && <span className="an-meta">{viewing.evaluator}</span>}
        <span className="an-meta">{new Date(viewing.ts).toLocaleString()}</span>
        {/* the filer's liveness — whether the session that filed this eval is still alive, so a human sees if
            an un-@'d remark on the rail reaches it live (the loop-in silently skips it when offline). */}
        <OriginatorLiveness originator={filer} sessions={sessions} kind="eval" />

        {/* the A/B history strip — the scenario's fail→pass lifecycle: verdict pips oldest→newest (✗ = an A
            repro, ✓ = a B fix), the viewed one lit, ‹ › to walk it. Shown only when there's more than one
            reading to flip between; a fresh scenario is just its single reading. */}
        {history && history.length > 1 && (
          <div className="an-ab">
            <button type="button" className="an-ab-nav" disabled={histIdx >= history.length - 1}
              onClick={() => setHistIdx((i) => Math.min(history.length - 1, i + 1))} title={t('annotator.abOlder')}>‹</button>
            <div className="an-ab-track">
              {history.slice().reverse().map((r, p) => {
                const idx = history.length - 1 - p
                return (
                  <button type="button" key={`${r.ts}-${idx}`}
                    className={`an-ab-pip ${verdictCls(r)} ${idx === histIdx ? 'on' : ''}`}
                    onClick={() => setHistIdx(idx)}
                    title={`${verdictMark(r)} ${new Date(r.ts).toLocaleString()}`}>
                    {verdictMark(r)}
                  </button>
                )
              })}
            </div>
            <button type="button" className="an-ab-nav" disabled={histIdx <= 0}
              onClick={() => setHistIdx((i) => Math.max(0, i - 1))} title={t('annotator.abNewer')}>›</button>
            <span className="an-ab-pos">{histIdx === 0 ? t('annotator.abLatest') : t('annotator.abPos', { i: history.length - histIdx, n: history.length })}</span>
          </div>
        )}
      </header>

      {/* the workspace — media STAGE center, remark RAIL right, both full-height; each scrolls itself, so
          circling on the stage and remarking in the rail never scroll each other out of view. */}
      <div className="an-work">
        <div className="an-stage-col">
          {viewing.expected && <div className="an-expected"><b>{t('nodeView.eval.expected')}</b> {viewing.expected}</div>}
          {ev.length > 0 && viewing.verdict?.note && <div className="an-expected an-prior-note"><b>{t('nodeView.eval.noteLabel')}</b> {viewing.verdict.note}</div>}

          {/* a stale reading is shown, not hidden — so the detail EXPLAINS how far it's fallen behind: which
              axes moved, and (for the code axis) which governed files drifted + by how many commits. */}
          {!viewing.fresh && (viewing.staleAxes?.length ?? 0) > 0 && (
            <div className="an-expected an-stale" title={t('nodeView.eval.staleReadoutTitle')}>
              <b>{t('nodeView.eval.staleLabel')}</b> {viewing.staleAxes.join(' · ')}
              {(viewing.codeDrift?.length ?? 0) > 0 &&
                <span className="an-stale-files"> — {viewing.codeDrift.map((d) => `${d.file.split('/').pop()} +${d.behind}`).join(', ')}</span>}
            </div>
          )}

          {/* the video — the annotate-a-loop surface: circle-to-capture, custom review-track scrubber, ruler.
              stage + control bar are ONE `an-player` wrapper so fullscreen carries the custom controls too
              (native chrome is suppressed here, so the bar's fullscreen button is the only door to it). */}
          {videoEntry && (
            <>
              <div className="an-player" ref={playerRef}>
              <div className={`an-stage ${playing ? 'playing' : 'paused'}`} ref={box} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}>
                <video className="an-video" ref={vid} src={`/api/yatsu/blob/${videoEntry.hash}`} preload="metadata" playsInline />
                {liveRect && <div className="an-rect live" style={{ left: `${liveRect.x}%`, top: `${liveRect.y}%`, width: `${liveRect.w}%`, height: `${liveRect.h}%` }} />}
                {!playing && !drag && <div className="an-bigplay" aria-hidden>▶</div>}
              </div>

              {/* the custom control bar — play/pause · review-track scrubber (comment markers + step bands) · time · live step · fullscreen */}
              <div className="an-bar">
                <button className="an-play" onClick={togglePlay} title={playing ? t('annotator.pause') : t('annotator.play')}>{playing ? '⏸' : '▶'}</button>
                <div className="an-seek" ref={seekRef} onMouseDown={onSeekDown} onMouseMove={onSeekHover} onMouseLeave={() => setHoverPct(null)}>
                  <div className="an-seek-trk" />
                  {durMs > 0 && events.map((e, i) => <div key={`band-${i}`} className="an-band" style={{ left: `${(e.tMs / durMs) * 100}%` }} title={e.step} />)}
                  <div className="an-seek-play" style={{ width: `${playPct}%` }} />
                  {durMs > 0 && anchored.map((a) => (
                    <button key={`mk-${a.i}`} type="button"
                      className={`an-mk ${selIdx === a.i ? 'on' : ''} ${activeIdx === a.i ? 'active' : ''}`}
                      style={{ left: `${(a.tMs / durMs) * 100}%` }} title={a.label}
                      onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); selectComment(a.i, a.tMs) }} />
                  ))}
                  <div className="an-knob" style={{ left: `${playPct}%` }} />
                  {hoverPct != null && durMs > 0 && <div className="an-seek-hov" style={{ left: `${hoverPct}%` }}>{mmss((hoverPct / 100) * durMs)}</div>}
                </div>
                <span className="an-time">{mmss(curMs)} / {mmss(durMs)}</span>
                {activeStep && <span className="an-curstep" title={activeStep.node ? `→ ${activeStep.node}` : undefined}>{activeStep.step}</span>}
                <FullscreenButton target={playerRef} />
              </div>
              </div>

              {events.length > 0 && (
                <div className="an-ruler">
                  {events.map((e, i) => (
                    <button key={i} className={`an-step ${stepAt(events, curMs) === e ? 'on' : ''}`}
                      onClick={() => seekMs(e.tMs)}
                      title={e.node ? `→ ${e.node}` : undefined}>
                      {mmss(e.tMs)} {e.step}
                    </button>
                  ))}
                </div>
              )}
              <div className="an-hint">{t('annotator.hint')}</div>
              <div className="an-keys">{t('annotator.keys')}</div>
              {flash && <div className="an-flash">{flash}</div>}
            </>
          )}

          {/* the still gallery + transcripts — every non-clip entry renders through the ONE shared
              evidence renderer (Evidence.jsx, U1): images click-to-enlarge, a pruned blob is the honest
              sentinel. Only the clip above is this pane's own — the annotate-a-loop specialization. */}
          {images.length > 0 && (
            <div className="an-gallery">
              {images.map((e, i) => <EvidenceItem e={e} alt={entry.scenario} key={`${e.hash}-${i}`} />)}
            </div>
          )}

          {transcripts.map((e, i) => <EvidenceItem e={e} alt={entry.scenario} key={`${e.hash}-${i}`} />)}

          {ev.length === 0 && (viewing.verdict?.note
            ? <pre className="eval-transcript">{viewing.verdict.note}</pre>
            : <div className="an-hint">{t('nodeView.eval.noImage')}</div>)}
        </div>

        <EvalRemarks entry={entry} comments={comments} specs={specs} sessions={sessions} onWrite={onWrite}
          codeSha={viewing.codeSha} seekMs={hasVideo ? seekMs : null} anchorNow={hasVideo ? anchorNow : null} draft={draft}
          selIdx={selIdx} activeIdx={activeIdx} onSelect={hasVideo ? selectComment : null} events={hasVideo ? events : null} />
      </div>
    </div>
  )
}

// the eval's REMARK track ([[remark-substrate]] / [[event-detail]]) — the workspace's always-visible RIGHT
// RAIL: the anchored remark list scrolls in the middle, the composer stays DOCKED at the rail's foot, so a
// circle on the stage lands in a composer that is already on screen (no scroll to the bottom of a stack).
// No new store: the thread is the ONE local Issue bound to this (node, scenario) by its concern key, folded
// in as `entry.thread` on BOTH homes. The composer authors a REMARK through the CLI-parity /api/remarks
// (find-or-create by (node, scenario) — no thread id or concern needed on the write side, L): the first
// remark mints the thread, every later one appends. A remark records the VIEWED reading's codeSha (R2).
// Anchored remarks (`▶m:ss · step`) linkify to their video moment (click = seek + select) and carry their
// circled frame; the selected and playhead-active remarks highlight in sync with the scrubber's markers; a
// resolved remark renders settled ([[remark-teeth]]). Rendered on EVERY eval home — a fresh scenario shows
// an empty track with a live composer.
function EvalRemarks({ entry, comments, codeSha, specs, sessions, onWrite, seekMs, anchorNow, draft, selIdx, activeIdx, onSelect, events }) {
  const t = useT()
  const send = (text, evidence) => postRemark({ node: entry.node, scenario: entry.scenario, body: text, codeSha, evidence })
  return (
    <aside className="an-rail">
      <div className="an-comments-head">{t('annotator.comments', { n: comments.length })}</div>
      <div className="an-rail-list">
        {/* threadId + onRemarkChange arm the rows' resolve/retract verbs (CLI-parity, [[remark-substrate]]):
            the human resolves an agent's unresolved remark (second-party judgment) or retracts their own —
            same endpoints `spex resolve`/`spex retract` parallel, reload through the host's onWrite. */}
        <Replies replies={comments} onSeek={seekMs} selIdx={selIdx} activeIdx={activeIdx} onSelect={onSelect} events={events}
          threadId={entry.thread?.id ?? null} onRemarkChange={() => onWrite?.('')} />
      </div>
      <div className="an-rail-compose">
        {/* keyed by the (node, scenario) identity: the composer owns its body state, so only a remount
            resets the working draft on selection change — a half-typed or circle-prefilled remark must
            die with its selection, never surface on another eval's thread (it would post there). */}
        <ReplyComposer key={`${entry.node}·${entry.scenario}`} onSend={send} specs={specs} sessions={sessions} focusId={entry.node} onDone={onWrite} anchorNow={anchorNow} draft={draft} />
      </div>
    </aside>
  )
}
