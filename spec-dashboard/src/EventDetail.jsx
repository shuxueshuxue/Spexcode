import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadReviewPlugins, postEvalOk, postRemark, putFrameBlob } from './data.js'
import { reviewCommandsFor, fillPreset } from './reviewCommands.js'
import { evidenceList } from './reviewFilters.js'
import { EvidenceItem, FullscreenButton } from './Evidence.jsx'
import { Replies, ReplyComposer, OriginatorLiveness, mmss, anchorLine, parseAnchor, resolveAnchor } from './Thread.jsx'
import { DetailShell, ReviewState, SideSection, SideValue, usePopover } from './ReviewShell.jsx'
import { readingScore } from './score.jsx'
import { useT } from './i18n/index.jsx'
import { Icon, IconButton } from './icons.jsx'
import { apiUrl } from './project.js'

// EventDetail ([[event-detail]], U1): the ONE evidence+reply detail, store-agnostic — the content of the
// Evals DETAIL page ([[evals-view]]), filling the shared [[review-chrome]] DetailShell with GitHub's
// issue-page grammar: the HEADER names the scenario + node, the STATUS band wears the verdict badge and
// the A/B strip, the MAIN column is the evidence WORKSPACE — the video under a CUSTOM review-track
// scrubber (anchored remarks as MARKERS, the playhead lighting the remark it is inside, click = seek; a
// step-timeline sidecar bands boundaries and names the live step), the image gallery, transcripts/data
// through the one shared EvidenceItem — followed by the (node, scenario) remark THREAD with its composer
// DOCKED STICKY at the column's foot; the SIDE rail is the reading/session metadata (evaluator, filed
// time, the filer's liveness, human-ok, staleness readout). The whole surface stays keyboard-driven
// (space, arrows, ,/. frame-fine, ↑/↓ jump remarks, a = annotate the current frame).
//
// There is ONE reply primitive: a REMARK on the eval's own (node, scenario) thread ([[remark-substrate]]) —
// a scenario-scoped concern is a remark, never an issue (I1). It is time-anchored by the `▶m:ss · step`
// prose convention ([[issues-view]]'s Thread), and an anchored mark CARRIES ITS MOMENT'S FRAME whichever
// gesture made it — ⏱/`a` capture the clean current frame, a drag-circle the same frame with its rect
// burned in — so every mark renders uniformly in the track. A remark's `resolved` bit renders in
// the thread (settled when resolved, prominent while open). The composer authors through the CLI-parity
// /api/remarks (L: the dashboard is a thin wrapper, no dashboard-only write). The pane READS readings and
// hosts remarks — it never files a reading: verdicts land through the CLI eval seam (`spex eval add`,
// [[eval-core]]) with evidence, and render here as the status badge + A/B pips.
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

// the deterministic concern key binding an eval's remark thread to its (node, scenario) — the thread IS a
// local Issue, keyed by this exact concern text (ids de-collide, concerns don't). Kept only for display /
// marker lookup; the WRITE side never needs it (the /api/remarks host is (node, scenario), find-or-create).
export const evalConcern = (e) => `eval: ${e.node} · ${e.scenario}`

// the A/B strip's bounded window ([[event-detail]]): at most this many verdict pips render — the strip
// stays ONE line at a stable height however many readings a scenario accrues.
export const AB_WINDOW = 8

// the strip's ONE overflow door: every reading not holding a pip, in one accessible menu (the shared
// popover mechanics — roving menuitemradio rows wearing the same shared ReviewState visual + position +
// filed time). Picking a row views that reading in place; no reading is ever unreachable.
function AbOverflow({ hidden, total, histIdx, onPick }) {
  const t = useT()
  const popover = usePopover()
  const label = t('annotator.abMore', { n: hidden.length })
  return (
    <div className="an-ab-more" ref={popover.ref}>
      <IconButton icon="ellipsis" size={14} className="an-ab-morebtn" label={label}
        aria-haspopup="menu" aria-expanded={popover.open}
        onClick={(event) => popover.toggle(event.currentTarget)} onKeyDown={popover.onTriggerKeyDown} />
      {popover.open && (
        <div className="rl-menu an-ab-menu" role="menu" aria-label={label} ref={popover.menuRef} onKeyDown={popover.onMenuKeyDown}>
          {hidden.map((r) => {
            const state = readingScore(r)
            return (
              <button type="button" role="menuitemradio" aria-checked={r.idx === histIdx} tabIndex={-1}
                key={`${r.ts}-${r.idx}`} className="rl-menu-item an-ab-menuitem" onFocus={popover.onItemFocus}
                onClick={() => { popover.close(true); onPick(r.idx) }}>
                <ReviewState kind="eval" state={state} size={13} />
                <span className="an-ab-menupos">{total - r.idx}/{total}</span>
                <span className="an-ab-menudate">{new Date(r.ts).toLocaleString()}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function EventDetail({ entry, history: providedHistory, sourceKey = 'project', specs = [], sessions = [], onWrite, onOpenSession, onFocusNode = null, listHref = null, backHref = null, backLabel = null, queue = { prev: [], next: [] } }) {
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

  // A/B history is already bounded by scenario at the page's ONE detail endpoint. EventDetail never opens
  // a node or session-wide model itself. `histIdx` indexes that newest-first list (0 = latest).
  const [history, setHistory] = useState(null)
  const [histIdx, setHistIdx] = useState(0)
  const viewing = (history && history[histIdx]) || entry
  // One semantic identity for every kind of composer-local state. A board repaint recreates props but keeps
  // this value; a real scope/scenario/A-B-reading change moves it and remounts the shared composer.
  const readingIdentity = `${histIdx}:${viewing.ts || viewing.codeSha || viewing.blob || 'reading'}`
  const reviewIdentity = `${sourceKey}·${entry.node}·${entry.scenario}·${readingIdentity}`

  // the review-track prose presets (`surface: review` plugins, [[review-commands]]) — fetched once; each
  // becomes a `/` command that PREFILLS the composer with its placeholder-filled body.
  const [reviewPresets, setReviewPresets] = useState([])
  useEffect(() => {
    let on = true
    loadReviewPlugins().then((d) => { if (on && Array.isArray(d)) setReviewPresets(d) }).catch(() => {})
    return () => { on = false }
  }, [])

  // a page/scope change is a new SCENARIO under annotation — reset the working state AND the history cursor,
  // then (re)source this scenario's server-projected history.
  useEffect(() => {
    setDrag(null); setFlash(''); setEvents([]); setDraft(null)
    setHistIdx(0); setHistory(null)
    setHistory(Array.isArray(providedHistory) ? providedHistory : [entry])
    // entry.humanOk?.ts rides the deps so a just-landed sign-off ([[human-ok]]) refetches the history —
    // `viewing` reads the fetched rows once they land, and without the refetch it would miss the new ok. On
    // the host's onWrite reloads the bounded detail, so an ok/remark still re-sources the walk.
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
  // overlay ([[remark-teeth]] / [[eval-issue-split]]), the SAME on every scope (the project list folds it
  // in through the board; the session scope through the proof model), so this pane never re-matches a
  // concern against a resident issues list. Computed here (not just in the thread section) so the scrubber
  // can render each anchored remark as a marker and the keyboard can jump between them.
  const thread = entry.thread ?? null
  // the review track is the thread's REMARKS — the replies carrying a `rid` ([[remark-substrate]]: "every
  // remark is a reply, NEVER the thread body"). The thread's ROOT body is a system-minted container stub,
  // not a human remark — mirror the backend's own `replies.filter(isRemark)`.
  const comments = useMemo(() => (thread?.replies ?? []).filter((r) => r.rid !== undefined), [thread])
  // the eval's ORIGINATOR ([[mentions]] loop-in) — the session that FILED this scenario's reading. The
  // chain's first link is the LATEST reading's filer, so read it from the newest history row (history is
  // newest-first), falling back to the viewed reading; a legacy reading without `by` yields nothing and the
  // side rail simply shows no filer.
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

  // a page change is a new reading — reset the player-specific state (the shared working state + the
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
    fetch(apiUrl(`/api/evidence/${viewing.timelineBlob}`))
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
    // same-hash page switch (or A/B flip) must still re-run this — the reset effect above just
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
  // selecting a remark is a review act — select + seek; the thread row scrolls into view via the selection.
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
  // sees); a failed capture degrades to the text-only anchor, never a blocked mark. The composer is
  // docked sticky at the column's foot, so the mark lands in a writer already on screen.
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
  // per-render runners — okRun is THE human-ok closure, fired by the typed /ok, the ONE dashboard door to
  // the sign-off (no header button); the gate is the registry's (viewed reading is the scenario's latest
  // and not yet ok'd). The presets ride behind them, each prefilling its placeholder-filled body.
  const okRun = async () => { const r = await postEvalOk(entry.node, entry.scenario).catch((err) => ({ error: String(err) })); onWrite?.(r?.error || '') }
  const reviewCmds = reviewCommandsFor({ okd: !!viewing.humanOk, isLatest: !history || histIdx === 0 }, { ok: okRun })
  const composerCommands = [
    ...reviewCmds.map((c) => ({ name: c.name, description: t(c.descKey), ui: true, color: c.color, run: c.run })),
    ...reviewPresets.map((p) => ({
      name: p.name, description: p.desc || p.title, source: 'review',
      prefill: () => fillPreset(p.body, { node: entry.node, scenario: entry.scenario, expected: viewing.expected || '' }),
    })),
  ]

  // the STATUS band — verdict + sign-off + the A/B strip, GitHub's status row under the title.
  const status = (
    <>
      <ReviewState kind="eval" state={readingScore(viewing)} showLabel className="an-verdict-badge" size={16} />
      {/* the human sign-off ([[human-ok]]): an ok'd reading wears its settled mark. The band carries NO
          write button — the ONE dashboard door to the ok is the composer's typed /ok
          ([[review-commands]]), gated exactly as the CLI. */}
      {viewing.humanOk &&
        <span className="an-okd" data-tip={t('annotator.okBy', { by: viewing.humanOk.by, at: new Date(viewing.humanOk.ts).toLocaleString() })}><Icon name="circle-check" size={14} /> {t('annotator.okd')}</span>}
      {/* the A/B history strip — the scenario's fail→pass lifecycle: the ONE shared verdict visual on
          every reading, the viewed one lit, shared chevrons to walk the WHOLE history. Shown only when
          there's more than one reading. BOUNDED to one line at a stable height: at most AB_WINDOW recent
          pips; a viewed reading older than the window takes the leftmost slot; every other reading lives
          behind the single accessible overflow menu. */}
      {history && history.length > 1 && (() => {
        const total = history.length
        const recent = Math.min(AB_WINDOW, total)
        // oldest→newest left-to-right (history is newest-first, so indices render descending)
        const pipIdxs = histIdx < AB_WINDOW
          ? Array.from({ length: recent }, (_, k) => recent - 1 - k)
          : [histIdx, ...Array.from({ length: AB_WINDOW - 1 }, (_, k) => AB_WINDOW - 2 - k)]
        const shown = new Set(pipIdxs)
        const hidden = history.map((r, idx) => ({ ...r, idx })).filter((r) => !shown.has(r.idx))
        return (
          <div className="an-ab">
            <IconButton icon="chevron-left" size={13} className="an-ab-nav" disabled={histIdx >= history.length - 1}
              onClick={() => setHistIdx((i) => Math.min(history.length - 1, i + 1))} label={t('annotator.abOlder')} />
            {hidden.length > 0 && <AbOverflow hidden={hidden} total={total} histIdx={histIdx} onPick={setHistIdx} />}
            <div className="an-ab-track">
              {pipIdxs.map((idx) => {
                const r = history[idx]
                const state = readingScore(r)
                return (
                  <button type="button" key={`${r.ts}-${idx}`}
                    className={`an-ab-pip ${idx === histIdx ? 'on' : ''}`}
                    aria-current={idx === histIdx ? 'true' : undefined}
                    onClick={() => setHistIdx(idx)}
                    aria-label={`${total - idx}/${total} · ${t(`score.${state}`)} · ${new Date(r.ts).toLocaleString()}`}>
                    <ReviewState kind="eval" state={state} size={13} />
                  </button>
                )
              })}
            </div>
            <IconButton icon="chevron-right" size={13} className="an-ab-nav" disabled={histIdx <= 0}
              onClick={() => setHistIdx((i) => Math.max(0, i - 1))} label={t('annotator.abNewer')} />
            <span className="an-ab-pos">{histIdx === 0 ? t('annotator.abLatest') : t('annotator.abPos', { i: history.length - histIdx, n: history.length })}</span>
          </div>
        )
      })()}
    </>
  )

  // the SIDE rail — reading/session metadata, GitHub's sidebar sections ([[review-chrome]]; reflows above
  // the workspace at phone width). Every value renders through the ONE SideValue primitive — shrinkable,
  // ellipsizing, full text on the tooltip — never a bare page-local span.
  const side = (
    <>
      <SideSection label={t('detail.sideReading')}>
        {viewing.evaluator && <SideValue text={viewing.evaluator} />}
        <SideValue text={new Date(viewing.ts).toLocaleString()} />
      </SideSection>
      {/* the reading's spec node as a REAL ref (explicitly labeled — information type is never guessed
          from a bare token): the shell's graph-focus door when the host wires one, a plain labeled
          value otherwise. */}
      <SideSection label={t('detail.sideNode')}>
        <SideValue text={entry.node} mono tip={onFocusNode ? t('session.issuesFocusNode') : entry.node}
          onClick={onFocusNode ? () => onFocusNode(entry.node) : null} />
      </SideSection>
      {filer && (
        <SideSection label={t('detail.sideFiler')}>
          {/* the filer's liveness — whether the session that filed this eval is still alive; live filers
              click through to their session console. */}
          <OriginatorLiveness originator={filer} sessions={sessions} kind="eval" onOpenSession={onOpenSession} />
        </SideSection>
      )}
      {viewing.humanOk && (
        <SideSection label={t('detail.sideOk')}>
          <SideValue text={`☑ ${viewing.humanOk.by}`} />
          <SideValue text={new Date(viewing.humanOk.ts).toLocaleString()} dim />
        </SideSection>
      )}
      {/* a stale reading is shown, not hidden — the side rail EXPLAINS how far it's fallen behind: which
          axes moved, and (for the code axis) which governed files drifted + by how many commits. */}
      {!viewing.fresh && (viewing.staleAxes?.length ?? 0) > 0 && (
        <SideSection label={t('nodeView.eval.staleLabel')}>
          <SideValue text={viewing.staleAxes.join(' · ')} tip={t('nodeView.eval.staleReadoutTitle')} />
          {(viewing.codeDrift?.length ?? 0) > 0 &&
            <SideValue text={viewing.codeDrift.map((d) => `${d.file.split('/').pop()} +${d.behind}`).join(', ')} dim />}
        </SideSection>
      )}
      {/* the Continue-reviewing queue ([[evals-view]] computes it from the page's source dataset): the
          neighbors of the current reading as REAL detail anchors — the one shared ReviewState visual +
          scenario/node text — in two POSITIONAL groups against the dataset's stable list order (Previous
          = before the current row, Up next = after it; nearest-to-current first — list direction, never
          a time claim). A group with no entries renders no heading; no neighbor at all, no section. */}
      {(queue.prev.length > 0 || queue.next.length > 0) && (
        <SideSection label={t('detail.sideQueue')}>
          {[['prev', t('detail.queuePrev')], ['next', t('detail.queueNext')]].map(([dir, label]) => queue[dir].length > 0 && (
            <div className="ds-queue-group" key={dir}>
              <span className="ds-queue-group-label">{label}</span>
              {queue[dir].map((q) => (
                <a key={q.key} className="ds-queue-row" href={q.href} data-tip={`${q.node} · ${q.scenario}`}>
                  <ReviewState kind="eval" state={q.state} size={13} />
                  <span className="ds-queue-scenario">{q.scenario}</span>
                  <span className="ds-queue-node">{q.node}</span>
                </a>
              ))}
            </div>
          ))}
        </SideSection>
      )}
    </>
  )

  // the docked composer ([[issues-view]]'s ONE shared thread composer): its scope/scenario/reading identity
  // resets ALL child-local state, including ordinary typed prose the outer anchored-draft state cannot see.
  // An unrelated board repaint keeps the key byte-identical. `commands` arms the review-track `/` menu;
  // the composer itself stays home-agnostic.
  const composer = (
    <ReplyComposer key={reviewIdentity}
      onSend={(text, evidence) => postRemark({ node: entry.node, scenario: entry.scenario, body: text, codeSha: viewing.codeSha, evidence })}
      specs={specs} sessions={sessions} focusId={entry.node} onDone={onWrite}
      anchorNow={hasVideo ? anchorNow : null} draft={draft} commands={composerCommands} />
  )

  return (
    <DetailShell
      title={entry.scenario}
      titleMeta={<span className="an-node">{entry.node}</span>}
      status={status}
      side={side}
      composer={composer}
      listHref={listHref}
      backHref={backHref}
      backLabel={backLabel}
    >
      {viewing.expected && <div className="an-expected"><b>{t('nodeView.eval.expected')}</b> {viewing.expected}</div>}
      {ev.length > 0 && viewing.verdict?.note && <div className="an-expected an-prior-note"><b>{t('nodeView.eval.noteLabel')}</b> {viewing.verdict.note}</div>}

      {/* the video — the annotate-a-loop surface: circle-to-capture, custom review-track scrubber, ruler.
          stage + control bar are ONE `an-player` wrapper so fullscreen carries the custom controls too
          (native chrome is suppressed here, so the bar's fullscreen button is the only door to it). */}
      {videoEntry && (
        <>
          <div className="an-player" ref={playerRef}>
          <div className={`an-stage ${playing ? 'playing' : 'paused'}`} ref={box} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}>
            <video className="an-video" ref={vid} src={apiUrl(`/api/evidence/${videoEntry.hash}`)} preload="metadata" playsInline />
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

      <EvalRemarks entry={entry} comments={comments} seekMs={hasVideo ? seekMs : null}
        selIdx={selIdx} activeIdx={activeIdx} onSelect={hasVideo ? selectComment : null} events={hasVideo ? events : null}
        onWrite={onWrite} />
    </DetailShell>
  )
}

// the eval's REMARK track ([[remark-substrate]] / [[event-detail]]) — the page's ACTIVITY: the anchored
// remark thread under the evidence workspace (GitHub's description→activity order), the composer living
// separately as the shell's docked-sticky foot. No new store: the thread is the ONE local Issue bound to
// this (node, scenario), folded in as `entry.thread`. Anchored remarks (`▶m:ss · step`) linkify to their
// video moment (click = seek + select) and carry their circled frame; the selected and playhead-active
// remarks highlight in sync with the scrubber's markers; a resolved remark renders settled
// ([[remark-teeth]]). A fresh scenario shows an empty track with the live composer below.
function EvalRemarks({ entry, comments, seekMs, selIdx, activeIdx, onSelect, events, onWrite }) {
  const t = useT()
  return (
    <section className="an-thread">
      <div className="an-comments-head">
        <span>{t('annotator.comments', { n: comments.length })}</span>
      </div>
      {/* threadId + onRemarkChange arm the rows' resolve/retract verbs (CLI-parity, [[remark-substrate]]):
          the human resolves an agent's unresolved remark (second-party judgment) or retracts their own —
          same endpoints `spex resolve`/`spex retract` parallel, reload through the host's onWrite. */}
      <Replies replies={comments} onSeek={seekMs} selIdx={selIdx} activeIdx={activeIdx} onSelect={onSelect} events={events}
        threadId={entry.thread?.id ?? null} onRemarkChange={() => onWrite?.('')} />
    </section>
  )
}
