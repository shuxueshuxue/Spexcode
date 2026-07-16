import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadReviewPlugins, postEvalOk, postRemark, putFrameBlob, specUrl } from './data.js'
import { reviewCommandsFor, fillPreset } from './reviewCommands.js'
import { evidenceList } from './EvalsFeed.jsx'
import { EvidenceItem, FullscreenButton } from './Evidence.jsx'
import { Replies, ReplyComposer, OriginatorLiveness, mmss, anchorLine, parseAnchor, resolveAnchor } from './Thread.jsx'
import { useT } from './i18n/index.jsx'
import { Icon, IconButton } from './icons.jsx'

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
// prose convention ([[issues-view]]'s Thread), and an anchored mark CARRIES ITS MOMENT'S FRAME whichever
// gesture made it — ⏱/`a` capture the clean current frame, a drag-circle the same frame with its rect
// burned in — so every mark renders uniformly in the track. A remark's `resolved` bit renders in
// the thread (settled when resolved, prominent while open). The composer authors through the CLI-parity
// /api/remarks (L: the dashboard is a thin wrapper, no dashboard-only write). The pane READS readings and
// hosts remarks — it never files a reading: verdicts land through the CLI eval seam (`spex eval add`,
// [[eval-core]]) with evidence, and render here as the header badge + A/B pips.
//
// A/B history ([[reproduce-before-fix]]): a scenario's readings are its lifecycle, and a bug fix leaves a
// fail→pass PAIR — the A (reproduced bug) and the B (verified fix). The pane flips through that whole
// per-scenario history (verdict pips + ‹ › nav), swapping the media in place, so the error→correct
// transition is right here, not just the latest reading.

const stepAt = (events, pos) => { let hit = null; for (const e of events) { if (e.at <= pos) hit = e; else break } return hit }

// a step map is anchored to its evidence's OWN axis ([[step-timeline]]). Normalize either schema to the
// axis-tagged shape the pane reads: legacy v1 IS the time axis with `tMs` as the position (tMs → at), so an
// old video step-map and a new `{ v: 2, axis: 'time' }` render byte-for-byte identically.
const normalizeTimeline = (j) => {
  if (!j || !Array.isArray(j.events)) return null
  const axis = j.v === 1 ? 'time' : (typeof j.axis === 'string' ? j.axis : 'time')
  const at = j.v === 1 ? (e) => e.tMs : (e) => e.at
  return { axis, events: j.events.map((e) => ({ at: at(e), step: e.step, ...(e.node ? { node: e.node } : {}) })) }
}

// the label for a position on the step map's axis — the ONE axis-aware surface (the moment/position is
// otherwise a bare number in the layout math). time → m:ss, frame → #123, line → L42, index → 3/N (the
// scrubber's extent supplies the denominator, read from the evidence at render time, never stored). An
// unknown axis is legal ([[step-timeline]] is open by convention) and renders as a bare number.
const axisLabel = (axis, pos, extent) =>
  axis === 'time' ? mmss(pos)
    : axis === 'frame' ? `#${pos}`
      : axis === 'line' ? `L${pos}`
        : axis === 'index' ? (extent ? `${pos}/${extent}` : `${pos}`)
          : String(pos)

// the named-step RAIL — the axis-general step ruler under any step-bearing evidence (a video's time bands, a
// transcript's line steps, a still sequence's frames). Click a step to seek (a no-op without a media
// element); the live step (the video playhead's) highlights. This is the capability that used to live only
// on the video: a non-video reading with a step-map now shows its rail too.
function StepRail({ events, axis, extent, activeStepIdx, onSeek }) {
  return (
    <div className="an-ruler">
      {events.map((e, i) => (
        <button key={i} className={`an-step ${activeStepIdx === i ? 'on' : ''}`}
          onClick={() => onSeek(e.at)}
          data-tip={e.node ? `→ ${e.node}` : undefined}>
          {axisLabel(axis, e.at, extent)} {e.step}
        </button>
      ))}
    </div>
  )
}

// verdict pip for the A/B history strip: ✓ pass (a B pole) / ✗ fail (an A pole) / · a pre-verdict legacy
// reading. The verdict is an object `{status, note}` (never a bare string), so read `.status`.
const verdictMark = (r) => (r.verdict?.status === 'pass' ? '✓' : r.verdict?.status === 'fail' ? '✗' : '·')
const verdictCls = (r) => (r.verdict?.status === 'pass' ? 'pass' : r.verdict?.status === 'fail' ? 'fail' : 'legacy')

// the deterministic concern key binding an eval's remark thread to its (node, scenario) — the thread IS a
// local Issue, keyed by this exact concern text (ids de-collide, concerns don't). Kept only for display /
// marker lookup; the WRITE side never needs it (the /api/remarks host is (node, scenario), find-or-create).
export const evalConcern = (e) => `eval: ${e.node} · ${e.scenario}`

export default function EventDetail({ entry, history: providedHistory, specs = [], sessions = [], onWrite, onOpenSession }) {
  const t = useT()
  const vid = useRef(null)
  const box = useRef(null)
  const seekRef = useRef(null)
  const playerRef = useRef(null)   // the video+controls wrapper — the fullscreen target (controls stay usable)
  const seq = useRef(0)
  const [events, setEvents] = useState([])
  const [axis, setAxis] = useState('time')       // the step map's evidence axis ([[step-timeline]])
  const [drag, setDrag] = useState(null)
  const [flash, setFlash] = useState('')         // circle-capture feedback (capturing… / failed)
  const [busy, setBusy] = useState(false)       // capturing a circled frame
  const [draft, setDraft] = useState(null)       // { seq, body } — a circle / `a` prefills the review-track composer
  // custom-player state: the playhead owns the review track now that native chrome is gone. The playhead
  // POSITION paints straight to the DOM (fill/knob/time via the refs below) — a state playhead re-rendered
  // the whole workspace, remark markdown re-parsed included, at every ~4Hz timeupdate tick. React state
  // keeps only the COARSE derivations (active step / active remark), set only when they actually flip.
  const fillRef = useRef(null)                   // .an-seek-play — width tracks the playhead
  const knobRef = useRef(null)                   // .an-knob — left tracks the playhead
  const timeRef = useRef(null)                   // .an-time — "m:ss / m:ss" text
  const curMsRef = useRef(0)                     // current time, ms — the one value the paints read/write
  const [dur, setDur] = useState(0)              // duration, seconds
  const [activeStepIdx, setActiveStepIdx] = useState(-1) // index into events of the step the playhead is in
  const [activeIdx, setActiveIdx] = useState(null)       // comments-index of the remark the playhead is inside
  const [playing, setPlaying] = useState(false)
  const [seeking, setSeeking] = useState(false)  // dragging the scrubber
  const [hoverPct, setHoverPct] = useState(null) // scrubber hover preview, 0..100 or null
  const [selIdx, setSelIdx] = useState(null)     // index (into comments) of the explicitly-selected comment

  // A/B history: this scenario's WHOLE reading history (newest-first). The SOURCE is HOME-provided so it shares
  // each home's ROOT ([[event-detail]]): the session eval tab hands down its WORKTREE-rooted readings
  // (`providedHistory`) — which always contain the un-merged in-session `entry` — while the Evals page passes
  // none and we lazily fetch the node's /api/specs/:id/evals timeline (the board only folds the LATEST reading
  // per scenario, [[graph-lean]]). `histIdx` indexes that list (0 = the latest, i.e. the `entry` the feed
  // selected); `viewing` is the reading actually shown — the entry until history lands, then the picked reading.
  const [history, setHistory] = useState(null)
  const [histIdx, setHistIdx] = useState(0)
  const viewing = (history && history[histIdx]) || entry

  // the review-track prose presets (`surface: review` plugins, [[review-commands]]) — fetched once; each
  // becomes a `/` command that PREFILLS the composer with its placeholder-filled body.
  const [reviewPresets, setReviewPresets] = useState([])
  useEffect(() => {
    let on = true
    loadReviewPlugins().then((d) => { if (on && Array.isArray(d)) setReviewPresets(d) }).catch(() => {})
    return () => { on = false }
  }, [])

  // a selection change is a new SCENARIO under annotation — reset the working state AND the history cursor,
  // then (re)source this scenario's history. When the home supplies it (the session tab's WORKTREE-rooted
  // readings), use that directly — re-fetching the main-checkout /api/specs timeline there would MISS the
  // un-merged in-session reading and strand the current video behind an older inherited one. The Evals page
  // supplies none, so fetch this scenario's slice of the node's timeline as before.
  useEffect(() => {
    setDrag(null); setFlash(''); setEvents([]); setDraft(null)
    setHistIdx(0); setHistory(null)
    if (providedHistory) { setHistory(providedHistory); return }
    let on = true
    fetch(specUrl(entry.node, 'evals'))
      .then((r) => (r.ok ? r.json() : null))
      .then((tl) => { if (on && Array.isArray(tl?.readings)) setHistory(tl.readings.filter((r) => r.scenario === entry.scenario)) })
      .catch(() => {})
    return () => { on = false }
    // entry.humanOk?.ts rides the deps so a just-landed sign-off ([[human-ok]]) refetches the history —
    // `viewing` reads the fetched rows once they land, and without the refetch it would miss the new ok. On the
    // session home the same refresh rides `providedHistory`: the host's onWrite reloads the model, handing down
    // a fresh array, so an ok/remark still re-sources the walk.
  }, [entry.node, entry.scenario, entry.ts, entry.blob, entry.humanOk?.ts, providedHistory])

  // flipping A/B changes the clip/stills under the pen — drop any in-progress mark or draft.
  useEffect(() => { setDrag(null); setDraft(null) }, [histIdx])

  // the reading's evidence LIST → its present video (the annotate-a-loop surface) and its still gallery, for
  // the CURRENTLY-VIEWED reading. A legacy scalar reading normalizes to a one-entry list, so an old
  // image/video/transcript still renders.
  const ev = evidenceList(viewing)
  const videoEntry = ev.find((e) => e.kind === 'video' && e.state === 'present')
  const images = ev.filter((e) => e.kind === 'image')
  // every non-clip, non-still entry — a transcript or a structured `data` block ([[evidence-kind-taxonomy]]) —
  // renders through the ONE shared EvidenceItem, which picks the element by kind; nothing is left behind.
  const docs = ev.filter((e) => e.kind !== 'video' && e.kind !== 'image')
  const hasVideo = !!videoEntry

  // the eval's remark track rides the reading as `entry.thread` — the ONE server-side (node,scenario)↔thread
  // overlay ([[remark-teeth]] / [[eval-issue-split]]), the SAME on BOTH homes (the issues-page feed folds it
  // in through the board; the session tab through the proof model), so this pane no longer re-matches a
  // concern against a resident issues list. Computed here (not just in the comments section) so the scrubber
  // can render each anchored remark as a marker and the keyboard can jump between them.
  const thread = entry.thread ?? null
  // the review track is the thread's REMARKS — the replies carrying a `rid` ([[remark-substrate]]: "every
  // remark is a reply, NEVER the thread body"). The thread's ROOT body is a system-minted container stub
  // ("Remarks on the `<scenario>` eval of [[node]]", authored under find-or-create to close the race
  // window), not a human remark — rendering it as a comment doubled every track (a phantom row above the
  // real remark, and an inflated "review track (N)" count). Mirror the backend's own `replies.filter(isRemark)`.
  const comments = useMemo(() => (thread?.replies ?? []).filter((r) => r.rid !== undefined), [thread])
  // the eval's ORIGINATOR ([[mentions]] loop-in) — the session that FILED this scenario's reading. The
  // chain's first link is the LATEST reading's filer, so read it from the newest history row (history is
  // newest-first), falling back to the viewed reading; a legacy reading without `by` yields nothing and the
  // header simply shows no originator.
  const filer = (history && history[0]?.by) || entry.by || null
  // the anchored subset, carrying each comment's index into `comments` and its moment — sorted by moment.
  // E2: the moment is resolved by STEP-NAME against THIS reading's timeline (resolveAnchor), so a marker sits
  // where the step actually is in the current clip, not at a frozen m:ss. A degraded anchor (its step gone
  // from the timeline) can't be reliably placed, so it drops off the scrubber — it still lists in the thread
  // as a readable-not-seekable chip.
  const anchored = useMemo(() => comments
    .map((c, i) => { const ra = resolveAnchor(parseAnchor(c.body), events); return ra && ra.seekable ? { i, tMs: ra.tMs, step: ra.step, label: ra.label } : null })
    .filter(Boolean)
    .sort((x, y) => x.tMs - y.tMs), [comments, events])
  // the paint handler below is bound per-video, not per-render — it reads the live lists through refs.
  const eventsRef = useRef(events); eventsRef.current = events
  const anchoredRef = useRef(anchored); anchoredRef.current = anchored
  // derive the coarse playhead state (active step / active remark) from the current moment; called from the
  // media paints AND when the lists themselves change (a fresh remark while paused). Bail-outs keep a
  // no-flip derivation render-free.
  const deriveActive = useCallback(() => {
    const ms = curMsRef.current
    const evs = eventsRef.current
    let sIdx = -1
    for (let i = 0; i < evs.length; i++) { if (evs[i].at <= ms) sIdx = i; else break }
    setActiveStepIdx((prev) => (prev === sIdx ? prev : sIdx))
    let aIdx = null
    for (const a of anchoredRef.current) { if (a.tMs <= ms) aIdx = a.i; else break }
    setActiveIdx((prev) => (prev === aIdx ? prev : aIdx))
  }, [])
  useEffect(() => { deriveActive() }, [anchored, events, deriveActive])

  // a selection change is a new reading — reset the player-specific state (the shared working state + the
  // A/B history cursor are reset by the history effect above). The DOM-painted playhead zeroes by hand.
  useEffect(() => {
    curMsRef.current = 0
    if (fillRef.current) fillRef.current.style.width = '0%'
    if (knobRef.current) knobRef.current.style.left = '0%'
    if (timeRef.current) timeRef.current.textContent = ''
    setActiveStepIdx(-1); setActiveIdx(null)
    setDur(0); setPlaying(false); setSeeking(false); setHoverPct(null); setSelIdx(null)
  }, [entry.blob, entry.scenario, entry.node])

  // the step map arrives lazily from the same blob cache the clip streams from; reset then (re)load on the
  // viewed reading. No longer video-gated — a step-map rides ANY axis-bearing evidence, so a transcript's
  // line steps load the same way; absent timeline → plain evidence, no rail.
  useEffect(() => {
    setEvents([]); setAxis('time')
    if (!viewing.timelineBlob) return
    let on = true
    fetch(`/api/evidence/${viewing.timelineBlob}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { const n = on && normalizeTimeline(j); if (n) { setEvents(n.events); setAxis(n.axis) } })
      .catch(() => {})
    return () => { on = false }
  }, [viewing.timelineBlob])

  // the playhead follows the media element — timeupdate (~4Hz) + seeked keep the track live; play/pause keep
  // the toggle honest. The fill/knob CSS transition smooths the coarse ticks. Position paints straight to
  // the DOM (see the refs above); only the coarse active step/remark go through state. No rAF loop — the
  // 4Hz media cadence plus the CSS smoothing is all the reviewer can see.
  useEffect(() => {
    const v = vid.current
    if (!v) return
    const paint = () => {
      const ms = Math.round((v.currentTime || 0) * 1000)
      const d = Math.round((v.duration || 0) * 1000)
      curMsRef.current = ms
      const p = d ? (ms / d) * 100 : 0
      if (fillRef.current) fillRef.current.style.width = `${p}%`
      if (knobRef.current) knobRef.current.style.left = `${p}%`
      if (timeRef.current) timeRef.current.textContent = `${mmss(ms)} / ${mmss(d)}`
      deriveActive()
    }
    const onMeta = () => { setDur(v.duration || 0); paint() }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    v.addEventListener('timeupdate', paint)
    v.addEventListener('seeked', paint)
    v.addEventListener('loadedmetadata', onMeta)
    v.addEventListener('durationchange', onMeta)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    // sync catch-up: a cached clip can reach readyState≥1 BEFORE these listeners attach, so the
    // loadedmetadata we rely on for `dur` may never be heard — read the element's current state
    // directly (onMeta also paints), instead of only waiting to be told.
    onMeta()
    return () => {
      v.removeEventListener('timeupdate', paint); v.removeEventListener('seeked', paint)
      v.removeEventListener('loadedmetadata', onMeta); v.removeEventListener('durationchange', onMeta)
      v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause)
    }
    // keyed on the VIEWED READING, not just the clip hash: readings routinely share one video blob, so a
    // same-hash selection switch (or A/B flip) must still re-run this — the reset effect above just
    // blanked the bar, and only this paint rewrites it (declaration order makes it the last writer).
  }, [videoEntry?.hash, entry.node, entry.scenario, histIdx, deriveActive])

  const durMs = Math.round(dur * 1000)
  const activeStep = events[activeStepIdx] || null
  // the axis EXTENT (the label denominator / scrubber span) is read from the EVIDENCE at render time, never
  // stored on the reading: time is the clip duration, frame the still count, index the step count. Only the
  // 'index' label uses it (3/N); the rest are self-describing.
  const axisExtent = axis === 'time' ? durMs : axis === 'frame' ? images.length : axis === 'index' ? events.length : 0

  const seekMs = useCallback((tMs) => { const v = vid.current; if (v) v.currentTime = tMs / 1000 }, [])
  const togglePlay = useCallback(() => { const v = vid.current; if (v) (v.paused ? v.play() : v.pause()) }, [])
  const selectComment = (i, tMs) => { setSelIdx(i); if (tMs != null) seekMs(tMs) }
  // the ONE frame grab all three mark gestures share (circle / ⏱ / `a`): capture the current frame at
  // natural resolution (a circle burns its rect in), stash it in the blob store, return the hash — null
  // when there is no decodable frame or the store refuses, so callers degrade to a text-only anchor
  // (the flash reports the miss).
  const grabFrame = useCallback(async (rect) => {
    const v = vid.current
    if (!v?.videoWidth) return null
    setBusy(true)
    setFlash(t('annotator.capturing'))
    try {
      // a capture mid-seek would draw the stale pre-seek frame — wait for the decode to land first
      if (v.seeking) await new Promise((res) => v.addEventListener('seeked', res, { once: true }))
      const cv = document.createElement('canvas')
      cv.width = v.videoWidth; cv.height = v.videoHeight
      const ctx = cv.getContext('2d')
      ctx.drawImage(v, 0, 0, cv.width, cv.height)
      if (rect) {
        ctx.strokeStyle = '#ff9a3c'; ctx.lineWidth = Math.max(2, cv.width / 300)
        ctx.strokeRect(rect.x / 100 * cv.width, rect.y / 100 * cv.height, rect.w / 100 * cv.width, rect.h / 100 * cv.height)
      }
      const blob = await new Promise((res) => cv.toBlob(res, 'image/png'))
      const { hash } = await putFrameBlob(blob)
      if (!hash) throw new Error('no hash')
      setFlash('')
      return hash
    } catch {
      setFlash(t('annotator.failed'))
      return null
    } finally { setBusy(false) }
  }, [t])

  // ⏱ stamps the moment the playhead is on — pause, the time + the step it is inside, AND the frame
  // itself (an anchored mark carries its moment's frame), so the composer's stamp makes the same mark a
  // circle or `a` does, minus the rect.
  const anchorNow = useCallback(async () => {
    const v = vid.current
    if (!v) return null
    v.pause()
    const tMs = Math.round((v.currentTime ?? 0) * 1000)
    return { tMs, step: stepAt(events, tMs)?.step ?? null, frame: await grabFrame(null) }
  }, [events, grabFrame])

  // mark the current moment (`a` = the clean frame, a drag = the circled rect): pause, capture, and
  // prefill the review-track composer with an anchored comment carrying the frame — the mark becomes a
  // reply. A step whose owning node differs routes the finding there (a `[[node]]` line the reviewer
  // sees); a failed capture degrades to the text-only anchor, never a blocked mark.
  const annotate = useCallback(async (rect) => {
    const v = vid.current
    if (!v) return
    v.pause()
    const tMs = Math.round((v.currentTime || 0) * 1000)
    const st = stepAt(events, tMs)
    const hash = await grabFrame(rect)
    const lines = [anchorLine(tMs, st?.step)]
    if (hash) lines.push(`![frame](/api/evidence/${hash})`)
    if (st?.node && st.node !== entry.node) lines.push(`re: [[${st.node}]]`)
    lines.push('')
    setDraft({ seq: ++seq.current, body: lines.join('\n') })
  }, [events, entry.node, grabFrame])

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
      else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); annotate(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasVideo, togglePlay, jumpAnchor, annotate])

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

  const onUp = () => {
    if (!drag) return
    const rect = {
      x: Math.min(drag.x0, drag.x), y: Math.min(drag.y0, drag.y),
      w: Math.abs(drag.x - drag.x0), h: Math.abs(drag.y - drag.y0),
    }
    setDrag(null)
    if (rect.w < 1 && rect.h < 1) { togglePlay(); return }   // a click, not a circle → play/pause
    annotate(rect)
  }
  const liveRect = drag && {
    x: Math.min(drag.x0, drag.x), y: Math.min(drag.y0, drag.y),
    w: Math.abs(drag.x - drag.x0), h: Math.abs(drag.y - drag.y0),
  }

  // the review-track commands ([[review-commands]]): the BUILT-IN verbs bind the registry's when-gates to
  // per-render runners — okRun is THE human-ok closure, called by the header button AND the typed /ok, so
  // the two can never drift; the gate mirrors the button exactly (viewed reading is the scenario's latest
  // and not yet ok'd). The presets ride behind them, each prefilling its placeholder-filled body.
  const okRun = async () => { const r = await postEvalOk(entry.node, entry.scenario).catch((err) => ({ error: String(err) })); onWrite?.(r?.error || '') }
  const reviewCmds = reviewCommandsFor({ okd: !!viewing.humanOk, isLatest: !history || histIdx === 0 }, { ok: okRun })
  const okCmd = reviewCmds.find((c) => c.name === 'ok') || null
  const composerCommands = [
    ...reviewCmds.map((c) => ({ name: c.name, description: t(c.descKey), ui: true, color: c.color, run: c.run })),
    ...reviewPresets.map((p) => ({
      name: p.name, description: p.desc || p.title, source: 'review',
      prefill: () => fillPreset(p.body, { node: entry.node, scenario: entry.scenario, expected: viewing.expected || '' }),
    })),
  ]

  return (
    <div className="an-detail">
      {/* the slim header — identity + verdict + the A/B strip, one row band over the workspace */}
      <header className="an-head">
        <span className="an-title">{entry.scenario}</span>
        <span className="an-node">{entry.node}</span>
        <span className={`an-verdict-badge ${verdictCls(viewing)}`}>{verdictMark(viewing)}</span>
        {viewing.evaluator && <span className="an-meta">{viewing.evaluator}</span>}
        <span className="an-meta">{new Date(viewing.ts).toLocaleString()}</span>
        {/* the filer's liveness — whether the session that filed this eval is still alive; live filers click
            through to their session-board tab. */}
        <OriginatorLiveness originator={filer} sessions={sessions} kind="eval" onOpenSession={onOpenSession} />

        {/* the human sign-off ([[human-ok]]): an ok'd reading wears its settled mark; an un-ok'd one offers
            the ok ONLY while the viewed reading IS the scenario's latest — the ok binds to one immutable
            reading, so blessing an older A/B pole would claim a reading the feed no longer scores. Same
            server write as `spex eval ok`. The button IS the registry's /ok command ([[review-commands]]):
            one when-gate, one runner — typing /ok in the composer fires this exact closure. */}
        {viewing.humanOk
          ? <span className="an-okd" data-tip={t('annotator.okBy', { by: viewing.humanOk.by, at: new Date(viewing.humanOk.ts).toLocaleString() })}>☑ {t('annotator.okd')}</span>
          : okCmd && (
            <button type="button" className="an-okbtn" data-tip={t(okCmd.titleKey)} onClick={okCmd.run}>
              ☑ {t(okCmd.labelKey)}
            </button>
          )}

        {/* the A/B history strip — the scenario's fail→pass lifecycle: verdict pips oldest→newest (✗ = an A
            repro, ✓ = a B fix), the viewed one lit, ‹ › to walk it. Shown only when there's more than one
            reading to flip between; a fresh scenario is just its single reading. */}
        {history && history.length > 1 && (
          <div className="an-ab">
            <IconButton icon="chevron-left" size={13} className="an-ab-nav" disabled={histIdx >= history.length - 1}
              onClick={() => setHistIdx((i) => Math.min(history.length - 1, i + 1))} label={t('annotator.abOlder')} />
            <div className="an-ab-track">
              {history.slice().reverse().map((r, p) => {
                const idx = history.length - 1 - p
                return (
                  <button type="button" key={`${r.ts}-${idx}`}
                    className={`an-ab-pip ${verdictCls(r)} ${idx === histIdx ? 'on' : ''}`}
                    onClick={() => setHistIdx(idx)}
                    data-tip={`${verdictMark(r)} ${new Date(r.ts).toLocaleString()}`}>
                    {verdictMark(r)}
                  </button>
                )
              })}
            </div>
            <IconButton icon="chevron-right" size={13} className="an-ab-nav" disabled={histIdx <= 0}
              onClick={() => setHistIdx((i) => Math.max(0, i - 1))} label={t('annotator.abNewer')} />
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
            <div className="an-expected an-stale" data-tip={t('nodeView.eval.staleReadoutTitle')}>
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
                <video className="an-video" ref={vid} src={`/api/evidence/${videoEntry.hash}`} preload="metadata" playsInline />
                {liveRect && <div className="an-rect live" style={{ left: `${liveRect.x}%`, top: `${liveRect.y}%`, width: `${liveRect.w}%`, height: `${liveRect.h}%` }} />}
                {!playing && !drag && <div className="an-bigplay" aria-hidden><Icon name="play" size={22} /></div>}
              </div>

              {/* the custom control bar — play/pause · review-track scrubber (comment markers + step bands) · time · live step · fullscreen */}
              <div className="an-bar">
                <IconButton icon={playing ? 'pause' : 'play'} size={14} className="an-play" label={playing ? t('annotator.pause') : t('annotator.play')} onClick={togglePlay} />
                <div className="an-seek" ref={seekRef} onMouseDown={onSeekDown} onMouseMove={onSeekHover} onMouseLeave={() => setHoverPct(null)}>
                  <div className="an-seek-trk" />
                  {durMs > 0 && axis === 'time' && events.map((e, i) => <div key={`band-${i}`} className="an-band" style={{ left: `${(e.at / durMs) * 100}%` }} data-tip={e.step} />)}
                  {/* fill/knob carry NO React-managed position style — the media paint owns them via refs */}
                  <div className="an-seek-play" ref={fillRef} />
                  {durMs > 0 && anchored.map((a) => (
                    <button key={`mk-${a.i}`} type="button"
                      className={`an-mk ${selIdx === a.i ? 'on' : ''} ${activeIdx === a.i ? 'active' : ''}`}
                      style={{ left: `${(a.tMs / durMs) * 100}%` }} data-tip={a.label}
                      onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); selectComment(a.i, a.tMs) }} />
                  ))}
                  <div className="an-knob" ref={knobRef} />
                  {hoverPct != null && durMs > 0 && <div className="an-seek-hov" style={{ left: `${hoverPct}%` }}>{mmss((hoverPct / 100) * durMs)}</div>}
                </div>
                {/* text owned by the media paint (ref) — constant-empty children so React never overwrites it */}
                <span className="an-time" ref={timeRef} />
                {activeStep && <span className="an-curstep" data-tip={activeStep.node ? `→ ${activeStep.node}` : undefined}>{activeStep.step}</span>}
                <FullscreenButton target={playerRef} />
              </div>
              </div>

              {events.length > 0 && (
                <StepRail events={events} axis={axis} extent={axisExtent} activeStepIdx={activeStepIdx} onSeek={seekMs} />
              )}
              <div className="an-hint">{t('annotator.hint')}</div>
              <div className="an-keys">{t('annotator.keys')}</div>
              {flash && <div className="an-flash">{flash}</div>}
            </>
          )}

          {/* a NON-video reading with a step-map (a transcript's line steps, a still sequence's frames) still
              gets its named-step rail — the axis-general capability, no longer welded to the clip. The video
              case renders its own rail inside the player above; this is only for evidence with no clip. */}
          {!videoEntry && events.length > 0 && (
            <StepRail events={events} axis={axis} extent={axisExtent} activeStepIdx={activeStepIdx} onSeek={seekMs} />
          )}

          {/* the still gallery + transcripts — every non-clip entry renders through the ONE shared
              evidence renderer (Evidence.jsx, U1): images click-to-enlarge, a pruned blob is the honest
              sentinel. Only the clip above is this pane's own — the annotate-a-loop specialization. */}
          {images.length > 0 && (
            <div className="an-gallery">
              {images.map((e, i) => <EvidenceItem e={e} alt={entry.scenario} key={`${e.hash}-${i}`} />)}
            </div>
          )}

          {/* structured `data` folds behind its header when the reading ALSO has a clip/still ([[event-detail]] /
              [[evidence-kind-taxonomy]]) — the media is the protagonist, the data a secondary drill-down; a
              data-only reading stays open (only DataBlock reads `collapsed`, so a transcript is unaffected). */}
          {docs.map((e, i) => <EvidenceItem e={e} alt={entry.scenario} collapsed={hasVideo || images.length > 0} key={`${e.hash}-${i}`} />)}

          {ev.length === 0 && (viewing.verdict?.note
            ? <pre className="eval-transcript">{viewing.verdict.note}</pre>
            : <div className="an-hint">{t('nodeView.eval.noImage')}</div>)}
        </div>

        <EvalRemarks entry={entry} comments={comments} specs={specs} sessions={sessions} onWrite={onWrite}
          codeSha={viewing.codeSha} seekMs={hasVideo ? seekMs : null} anchorNow={hasVideo ? anchorNow : null} draft={draft}
          selIdx={selIdx} activeIdx={activeIdx} onSelect={hasVideo ? selectComment : null} events={hasVideo ? events : null}
          commands={composerCommands} />
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
function EvalRemarks({ entry, comments, codeSha, specs, sessions, onWrite, seekMs, anchorNow, draft, selIdx, activeIdx, onSelect, events, commands = null }) {
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
        {/* `commands` arms the composer's review-track `/` menu ([[review-commands]]) — the built-in verbs
            + the `surface: review` presets the host gathered; the composer itself stays home-agnostic. */}
        <ReplyComposer key={`${entry.node}·${entry.scenario}`} onSend={send} specs={specs} sessions={sessions} focusId={entry.node} onDone={onWrite} anchorNow={anchorNow} draft={draft} commands={commands} />
      </div>
    </aside>
  )
}
