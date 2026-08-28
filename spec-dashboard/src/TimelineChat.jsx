import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { elapsed } from './toolVocabulary.js'
import { sessionHeadline, STATUS_COLOR, STATUS_GLYPH } from './session.js'
import { interruptSession, loadSessionTimeline, loadSessionDetail, loadSessionTranscript, sendSessionCommand, subscribeSessionTranscript } from './data.js'
import { useT } from './i18n/index.jsx'
import { useIsMobile } from './useIsMobile.js'
import { richTextFromRange } from './RichText.js'
import 'katex/dist/katex.min.css'
import { ComposerSurface, ComposerTextarea, composingKey } from './Composer.jsx'
import { Caret, Icon, IconButton } from './icons.jsx'
import LiveTail from './LiveTail.jsx'
import { Quote, TimelineRichText, timeOf, TranscriptPayload } from './Transcript.jsx'
import { conversationItems } from './conversationItems.js'
import { boardCommandFor, expandMentions, typeTrigger, useMentionAutocomplete } from './mentions.jsx'
import { useAttachQueue } from './useAttachQueue.jsx'
import { useCommandPresets, useHarnessCommands, useLaunchers } from './launch.js'
import { inboxCommands } from './sessionCommands.js'

// a short date for the day separators the timeline inserts when the calendar day flips between
// neighbouring events; the row time itself is the transcript's (./Transcript.jsx).
const dayOf = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
const dayKey = (ts) => new Date(ts).toDateString()

const transcriptCache = new Map()

function transcriptKey(sessionId, from, to) { return `${sessionId}:${from}:${to}` }
// The interval end moves when a later event closes the seam; expansion belongs to the seam itself.
function seamKey(sessionId, from) { return `${sessionId}:${from}` }

// a poll answer is usually the SAME history — keep the old array identity then, so nothing downstream
// (the pin effect above all) re-fires on a no-change tick. Append-only log: length + last entry decide.
const sameEvents = (a, b) => a != null && a.length === b.length
  && (a.length === 0 || JSON.stringify(a[a.length - 1]) === JSON.stringify(b[b.length - 1]))

const SELECTION_CONTROLS = 'button, summary, a, input, textarea, select, option, label, [role], [contenteditable]:not([contenteditable="false"])'
const EDITING_KEYS = new Set([
  'Backspace', 'Delete', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Home', 'End', 'PageUp', 'PageDown',
])
// Mirrors @xterm/xterm 6 SelectionService: mousedown chooses the mode from event.detail and the
// document mousemove for that same press extends the mode-specific anchor.
const SelectionMode = Object.freeze({ NORMAL: 0, WORD: 1, LINE: 2 })

const hasTimelineHighlight = () => typeof Highlight !== 'undefined'
  && typeof CSS !== 'undefined' && !!CSS.highlights

const clearTimelineHighlight = () => {
  if (hasTimelineHighlight()) CSS.highlights.delete('timeline-sel')
}

// The custom path exists only where both halves do; without them the press stays the browser's.
const hasTimelineSelection = () => hasTimelineHighlight() && typeof document.caretRangeFromPoint === 'function'

// @@@leaked-selection - the browser can still own a Selection over the timeline (a drag begun on a control,
// a fourth quick click), and the cancelled mousedown that keeps the composer caret also cancels the browser's
// own click-to-collapse — so a leaked Selection must be retired here or it outlives every later press.
const clearNativeSelectionWithin = (timeline) => {
  const selection = document.getSelection()
  if (!timeline || !selection || selection.rangeCount === 0) return
  const inside = (node) => !!node && timeline.contains(node)
  if (inside(selection.anchorNode) || inside(selection.focusNode)) selection.removeAllRanges()
}

const setTimelineHighlight = (range) => {
  if (!hasTimelineHighlight() || !range || range.collapsed) return false
  CSS.highlights.set('timeline-sel', new Highlight(range))
  return true
}

const execCopyFallback = (text) => {
  let eventConfirmed = false
  const onCopy = (event) => {
    if (!event.clipboardData) return
    try {
      event.clipboardData.setData('text/plain', text)
      event.preventDefault()
      eventConfirmed = true
    } catch { /* the result remains an honest failure */ }
  }
  document.addEventListener('copy', onCopy, true)
  let commandConfirmed = false
  try { commandConfirmed = document.execCommand('copy') === true } catch { /* the result remains an honest failure */ }
  document.removeEventListener('copy', onCopy, true)
  return eventConfirmed && commandConfirmed
}

// One clipboard capability seam for the custom Range shortcut and the no-Custom-Highlight copy button.
// The event fallback writes the payload without creating a Selection, temporary textarea, or focus handoff.
const copyTimelineText = async (text) => {
  try {
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* plain HTTP and denied permissions continue through the synchronous browser copy path */ }
  return execCopyFallback(text)
}

const rangeAtPoint = (timeline, clientX, clientY) => {
  const range = document.caretRangeFromPoint?.(clientX, clientY)
  return range && timeline.contains(range.startContainer) ? range : null
}

const wordRangeAtPoint = (timeline, clientX, clientY) => {
  const point = rangeAtPoint(timeline, clientX, clientY)
  const node = point?.startContainer
  if (!node || node.nodeType !== Node.TEXT_NODE || !node.data) return null

  const offset = Math.min(point.startOffset, node.data.length)
  let bounds = null
  if (typeof Intl.Segmenter === 'function') {
    const segments = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(node.data)]
    bounds = segments.find(({ index, segment, isWordLike }) => (
      isWordLike && index <= offset && offset < index + segment.length
    )) || segments.findLast(({ index, segment, isWordLike }) => (
      isWordLike && index < offset && offset <= index + segment.length
    ))
    if (bounds) bounds = [bounds.index, bounds.index + bounds.segment.length]
  }
  if (!bounds) {
    const isWord = (char) => /[\p{L}\p{M}\p{N}_]/u.test(char)
    let start = Math.min(offset, node.data.length - 1)
    if (!isWord(node.data[start]) && start > 0 && isWord(node.data[start - 1])) start -= 1
    if (!isWord(node.data[start])) return null
    let end = start + 1
    while (start > 0 && isWord(node.data[start - 1])) start -= 1
    while (end < node.data.length && isWord(node.data[end])) end += 1
    bounds = [start, end]
  }

  const range = document.createRange()
  range.setStart(node, bounds[0])
  range.setEnd(node, bounds[1])
  return range
}

const lineRangeAtPoint = (timeline, clientX, clientY) => {
  const point = rangeAtPoint(timeline, clientX, clientY)
  const node = point?.startContainer
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
  const line = element?.closest('.m-ev-note, .m-ev-text')
  if (!line || !timeline.contains(line)) return null
  const range = document.createRange()
  range.selectNodeContents(line)
  return range
}

const rangeFromAnchorToFocus = (anchor, focus, mode) => {
  const forward = anchor.compareBoundaryPoints(Range.START_TO_START, focus) <= 0
  const start = forward ? anchor : focus
  const end = forward ? focus : anchor
  const range = document.createRange()
  range.setStart(start.startContainer, start.startOffset)
  if (mode === SelectionMode.NORMAL) range.setEnd(end.startContainer, end.startOffset)
  else range.setEnd(end.endContainer, end.endOffset)
  return range
}

// The shared surface renders as the semantic footer (`<footer className=...>`); keeping that landmark on
// the primitive means Conversation and Command Box still have one shell rather than nested card chrome.
//
// THE CONVERSATION FOOTER IS A COMMAND BOX, not a picture of one. Its `@`, `[[` and `/` doors open the same
// shared autocomplete the terminal Command Box opens ([[mentions]]: session and launcher rows behind `@`,
// spec nodes behind `[[`, board commands then presets then harness commands behind `/`), a `[[node]]` in the
// draft expands to its live spec.md pointer at send, an exact `/stop`-style board line runs on the board,
// and the paperclip, a pasted screenshot or a dropped file all go through the one resumable upload path
// ([[file-attach]]) and leave the file's path in this draft. The only Command Box control this surface does
// not carry is the terminal-only Alt+I opener, because this composer is already open.
function TimelineFooter({ session, state, active, inputRef, draft, setDraft, sending, send, sendErr, sendNote, onRestore, actionOutcome, onComposerPress, working = false, stopping = false, stop, specs = [], sessions = [], boardCommands = [] }) {
  const t = useT()
  const readOnly = state !== 'live'
  // STOP IS IN THE COMPOSER, and only while there is something to stop: the square every chat reader knows,
  // beside send, shown while the agent is working and gone otherwise — a permanently visible disabled stop
  // would be chrome about a state the page is not in. One verb; the backend decides native vs the pane's key.
  const canStop = !readOnly && working
  const { launchers } = useLaunchers()
  const presets = useCommandPresets()
  const harnessCommands = useHarnessCommands(session?.harness)
  // the Command Box's one ordered vocabulary: board rows (run HERE) lead, presets follow, harness commands last
  const commands = useMemo(() => inboxCommands(boardCommands, presets, harnessCommands), [boardCommands, presets, harnessCommands])
  const grammar = useMentionAutocomplete({
    inputRef, value: draft, setValue: setDraft, specs, sessions, launchers, up: true,
    slash: { commands, mode: 'line', head: t('session.menuCommands'), onPick: (item) => {
      if (!item.ui) return false
      setDraft('')
      item.run?.()
      return true
    } },
  })
  const attach = useAttachQueue({ inputRef, setValue: setDraft, variant: 'command', disabled: readOnly })
  const insertTrigger = (trigger) => typeTrigger(inputRef.current, trigger, setDraft, grammar.sync)
  // what Enter and the send mark do with the draft: a bare board line runs on the board, anything else is
  // sent with its `[[node]]` mentions resolved to live spec pointers.
  const submit = () => {
    if (readOnly) return
    const raw = draft.trim()
    if (!raw) return
    const board = boardCommandFor(raw, commands)
    if (board) { setDraft(''); grammar.close(); board.run?.(); return }
    send(expandMentions(raw, specs))
  }
  return (
    <ComposerSurface
      as="footer"
      className={`m-composer is-${state}${attach.dragging ? ' dragover' : ''}`}
      data-footer-state={state}
      {...attach.dropProps}
      preview={(sendErr || sendNote) && <div className={sendErr ? 'm-senderr' : 'm-sendnote'}>{sendErr || sendNote}</div>}
      editor={(
        <>
        <div className="m-composer-line fv-tawrap">
          <ComposerTextarea
            ref={inputRef}
            className="m-input"
            data-focus-sink={active && !readOnly ? '' : undefined}
            rows={1}
            placeholder={t('mobile.inputPlaceholder')}
            value={draft}
            disabled={readOnly}
            onMouseDownCapture={onComposerPress}
            onChange={(e) => { setDraft(e.target.value); grammar.sync(e.target) }}
            onSelect={(e) => grammar.sync(e.target)}
            onBlur={grammar.close}
            onPaste={attach.onPaste}
            onKeyDown={(e) => {
              if (composingKey(e)) return
              // an open completion menu owns ↑/↓/Enter/Tab/Esc, so accepting a row never also sends
              if (grammar.onKeyDown(e)) return
              if (!readOnly && e.key === 'Enter' && !e.shiftKey && !composingKey(e)) {
                e.preventDefault(); e.stopPropagation(); submit()
              }
            }}
          />
          {grammar.menuEl}
        </div>
        {attach.queue}
        </>
      )}
      footer={(
        <>
          {attach.fileInput}
          <div className="si-command-tools m-composer-tools">
            <span className="si-command-title"><Icon name="command" size={12} />{t('session.commandBox')}</span>
            <button type="button" className="fv-trigger-btn" disabled={readOnly} data-tip={t('thread.mentionActor')} aria-label={t('thread.mentionActor')} onMouseDown={(e) => e.preventDefault()} onClick={() => insertTrigger('@')}>@</button>
            <button type="button" className="fv-trigger-btn" disabled={readOnly} data-tip={t('thread.mentionNode')} aria-label={t('thread.mentionNode')} onMouseDown={(e) => e.preventDefault()} onClick={() => insertTrigger('[[')}>[[</button>
            <button type="button" className="fv-trigger-btn" disabled={readOnly} data-tip={t('session.menuCommands')} aria-label={t('session.menuCommands')} onMouseDown={(e) => e.preventDefault()} onClick={() => insertTrigger('/')}>/</button>
            <IconButton icon={attach.busy ? 'loader' : 'paperclip'} size={14} iconClassName={attach.busy ? 'si-attach-busy' : undefined}
              className="si-command-tool" label={t('session.attachTitle')} disabled={readOnly || attach.busy} onClick={attach.pick} />
            {canStop && (
              <IconButton icon="stop" size={12} className="m-stop" label={t('mobile.stop')} disabled={stopping}
                onMouseDown={(e) => e.preventDefault()} onClick={stop} />
            )}
            <IconButton icon="send" size={14} className="m-send" label={t('mobile.send')}
              disabled={readOnly || !draft.trim() || sending} onMouseDown={(e) => e.preventDefault()} onClick={submit} />
          </div>
          {readOnly && (
            <div className="m-coldline">
              <span>{t(state === 'archived' ? 'session.archivedReadOnly' : 'session.offlineReadOnly')}</span>
              {onRestore && <button type="button" className="m-coldline-action" disabled={actionOutcome?.phase === 'pending'} onClick={onRestore}>
                {t(state === 'archived' ? 'session.shelfRestore' : 'session.relaunch')}
              </button>}
            </div>
          )}
          {readOnly && actionOutcome && (
            <div className={`si-action-outcome ${actionOutcome.phase}`} role={actionOutcome.phase === 'failed' ? 'alert' : 'status'}>
              {actionOutcome.message}
            </div>
          )}
        </>
      )}
    />
  )
}

// `specs` feeds the `[[` door and send-time expansion; `boardCommands` are the host's board rows (`[ui]`,
// run on the board) for the `/` palette — the phone host passes none and keeps presets + harness commands.
export default function TimelineChat({ s, sessions = [], active = true, footerState = 'live', onRestore, actionOutcome, specs = [], boardCommands = [] }) {
  const t = useT()
  const isMobile = useIsMobile()
  const [events, setEvents] = useState(null)
  const [detail, setDetail] = useState(null)   // the record detail — carries the full originating prompt
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [sendErr, setSendErr] = useState(null)
  const [sendNote, setSendNote] = useState(null)   // the last send's child receipt (`@new`), if any
  const [copyStatus, setCopyStatus] = useState(null)
  const [expandedSeams, setExpandedSeams] = useState(() => new Set())
  const [transcripts, setTranscripts] = useState(() => new Map())
  const [tail, setTail] = useState(null)   // the open seam's streamed payload ([[session-transcript]]); null until the first frame
  const [now, setNow] = useState(() => Date.now())   // advances with each timeline read; only an open live seam reads it
  const scrollRef = useRef(null)
  const timelineContentRef = useRef(null)
  const inputRef = useRef(null)
  const selectionDragRef = useRef(null)
  const timelineRangeRef = useRef(null)
  const copyStatusTimerRef = useRef(null)
  // THE OPEN TAIL'S INTERVAL ENDS AT THE LATEST POLL. It used to end at mount time so the transcript key
  // stayed stable — which also meant an EXPANDED live seam never re-read: its `0 turns · 0 tool uses` froze
  // the moment it opened and nothing the agent did afterwards was inside the interval. The end now moves
  // with each timeline read (server clock), so the expanded seam refreshes each poll; the seam's identity
  // is its start, so the disclosure survives the moving end, and a collapsed seam still reads nothing.
  const [pollNow, setPollNow] = useState(() => Date.now())
  const skewRef = useRef(0)   // server clock minus ours, re-read on every timeline response
  const inflightRef = useRef(new Set())   // transcript keys being read right now
  const wantedRef = useRef(new Map())     // seamId → the interval key it currently maps to
  const cachedKeyRef = useRef(new Map())  // seamId → the last key the module cache holds for it
  const pinnedRef = useRef(true)   // is the reader at the newest entry? Only then does a refresh follow it.

  const load = useCallback(() => loadSessionTimeline(s.id).then((d) => {
    if (Number.isFinite(d?.serverNow)) skewRef.current = d.serverNow - Date.now()
    const serverNow = Date.now() + skewRef.current
    setNow(serverNow); setPollNow(serverNow)
    if (d) setEvents((prev) => (sameEvents(prev, d.events) ? prev : d.events))
  }), [s.id])
  // THE LIVE SEAM COUNTS EVERY SECOND. The record only moves on a poll, so between polls the tail seam
  // used to sit on one number for eight seconds and then jump. The tick is the browser's, the clock is the
  // server's (its Date header, re-read each poll), and each tick recomputes from the seam's own start — so
  // the count never drifts, agrees with the durations the record will write, and stops the moment the
  // status leaves `working` because the interval exists only while it is.
  const ticking = active && footerState === 'live' && s.status === 'working'
  useEffect(() => {
    if (!ticking) return undefined
    const tick = () => { if (document.visibilityState !== 'hidden') setNow(Date.now() + skewRef.current) }
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [ticking])
  useEffect(() => {
    setEvents(null); setDetail(null); setCopyStatus(null); setSendNote(null); setExpandedSeams(new Set()); setTranscripts(new Map()); inflightRef.current.clear(); wantedRef.current.clear(); cachedKeyRef.current.clear(); setNow(Date.now()); setPollNow(Date.now()); pinnedRef.current = true
  }, [s.id])
  useEffect(() => {
    if (!active) return undefined
    load(); loadSessionDetail(s.id).then((d) => { if (d) setDetail(d) })
    return undefined
  }, [s.id, load, active])
  useEffect(() => {
    if (!active || isMobile || document.visibilityState === 'hidden') return undefined
    const focusFrame = requestAnimationFrame(() => {
      const input = inputRef.current
      if (active && !isMobile && document.visibilityState !== 'hidden'
        && input?.offsetParent !== null && getComputedStyle(input).visibility !== 'hidden'
        && document.activeElement !== input) input.focus()
    })
    return () => cancelAnimationFrame(focusFrame)
  }, [s.id, active, isMobile])
  // @@@archived-history-no-poll - archived records are immutable; offline records can still receive sent events from external `spex session send`, so only archived skips the interval.
  useEffect(() => {
    if (!active || footerState === 'archived') return undefined
    const iv = setInterval(load, 8000)
    return () => clearInterval(iv)
  }, [load, active, footerState])
  useEffect(() => { if (active && footerState !== 'archived') load() }, [s.status, s.note, load, active, footerState])

  const items = useMemo(() => conversationItems(events || [], pollNow), [events, pollNow])
  // THE OPEN SEAM STREAMS. A working record ends in an open seam; while the session is live that seam
  // subscribes to its interval's stream — the server re-reads the native thread only when it changed and
  // pushes the whole normalized payload — so the collapsed live tail and the expanded transcript are one
  // read, refreshed the instant the agent acts rather than on the next poll. The seam's start is the
  // subscription's identity: a later message opens a new seam and a new stream.
  const openSeam = items.length && items[items.length - 1].kind === 'seam' && items[items.length - 1].open ? items[items.length - 1] : null
  const streamFrom = active && footerState === 'live' && openSeam ? openSeam.from : null
  useEffect(() => {
    setTail(null)
    if (streamFrom === null) return undefined
    return subscribeSessionTranscript(s.id, streamFrom, setTail)
  }, [s.id, streamFrom])
  // what the agent most recently SAID on the record — the live tail elides a note the record already carries
  const lastSaid = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'say' && items[i].text) return items[i].text
    return null
  }, [items])

  const fetchTranscript = useCallback(async (seam, seamId) => {
    const key = transcriptKey(s.id, seam.from, seam.to)
    wantedRef.current.set(seamId, key)
    const cached = transcriptCache.get(key)
    if (cached) {
      setTranscripts((previous) => new Map(previous).set(seamId, { ...cached, transcriptKey: key }))
      return
    }
    if (inflightRef.current.has(key)) return
    inflightRef.current.add(key)
    // the FIRST read of a seam shows its loading line; a REFRESH of an open tail keeps what is on screen
    // until the fresh read lands, so the numbers move without the transcript blinking away every poll
    setTranscripts((previous) => (previous.get(seamId)?.state === 'ready'
      ? previous : new Map(previous).set(seamId, { state: 'loading', transcriptKey: key })))
    const result = await loadSessionTranscript(s.id, seam.from, seam.to)
    inflightRef.current.delete(key)
    const value = result.ok
      ? { state: 'ready', data: result.data, transcriptKey: key }
      : { state: 'error', error: result.error, transcriptKey: key }
    // the module cache keeps ONE interval per seam: a moving tail's previous read is superseded, not hoarded
    const previousKey = cachedKeyRef.current.get(seamId)
    if (previousKey && previousKey !== key) transcriptCache.delete(previousKey)
    transcriptCache.set(key, value); cachedKeyRef.current.set(seamId, key)
    setTranscripts((previous) => {
      // A newer poll may have moved this seam to another interval while this request was in flight.
      if (wantedRef.current.get(seamId) !== key) return previous
      const current = previous.get(seamId)
      // a refresh that failed keeps the last good read on screen; the next poll's new interval retries
      if (!result.ok && current?.state === 'ready') return new Map(previous).set(seamId, { ...current, transcriptKey: key })
      return new Map(previous).set(seamId, value)
    })
  }, [s.id])

  // A later event changes only the seam's interval, never the user's disclosure choice. Refresh the
  // expanded seam against that new interval while keeping it open.
  useEffect(() => {
    if (!active || !events) return undefined
    for (const seam of items) {
      if (seam.kind !== 'seam' || (seam.open && seam.from === streamFrom)) continue
      const seamId = seamKey(s.id, seam.from)
      if (!expandedSeams.has(seamId)) continue
      const key = transcriptKey(s.id, seam.from, seam.to)
      const current = transcripts.get(seamId)
      if (current?.transcriptKey === key || inflightRef.current.has(key)) continue
      void fetchTranscript(seam, seamId)
    }
    return undefined
  }, [active, events, items, expandedSeams, fetchTranscript, s.id, transcripts, streamFrom])
  // chat-style pinning that respects the thumb: follow new entries only while the reader is already at
  // the bottom — a reader parked up in history is never yanked down by a poll.
  const followTimelineTail = useCallback(() => {
    const timeline = scrollRef.current
    if (timeline && pinnedRef.current) timeline.scrollTop = timeline.scrollHeight
  }, [])
  const onScroll = () => { const el = scrollRef.current; if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48 }
  useLayoutEffect(followTimelineTail, [events, followTimelineTail])
  useLayoutEffect(() => {
    if (!active || typeof ResizeObserver !== 'function') return undefined
    const content = timelineContentRef.current
    if (!content) return undefined
    const observer = new ResizeObserver(followTimelineTail)
    observer.observe(content)
    return () => observer.disconnect()
  }, [active, followTimelineTail])

  const clearSelection = () => {
    timelineRangeRef.current = null
    clearTimelineHighlight()
    clearNativeSelectionWithin(scrollRef.current)
    setCopyStatus(null)
  }

  const copyText = useCallback(async (text) => {
    clearTimeout(copyStatusTimerRef.current)
    setCopyStatus(null)
    const copied = await copyTimelineText(text)
    setCopyStatus(copied ? 'copied' : 'failed')
    if (copied) {
      copyStatusTimerRef.current = setTimeout(() => setCopyStatus(null), 1200)
    }
    return copied
  }, [])

  useEffect(() => () => clearTimeout(copyStatusTimerRef.current), [])

  // Custom Highlight preserves the textarea caret while conversation text is selected.
  const beginTimelineSelection = (e) => {
    const timeline = scrollRef.current
    const target = e.target
    if (e.button !== 0 || !timeline || !(target instanceof Element) || !hasTimelineSelection()) return
    const control = target.closest(SELECTION_CONTROLS)
    if (control && timeline.contains(control)) return
    if (target === timeline) {
      const rect = timeline.getBoundingClientRect()
      if (e.clientX - rect.left - timeline.clientLeft >= timeline.clientWidth
        || e.clientY - rect.top - timeline.clientTop >= timeline.clientHeight) return
    }
    // From here the press is the timeline's whether or not it lands on selectable text: it retires every
    // selection and keeps the composer caret. A press left to the browser would select natively instead.
    clearSelection()
    e.preventDefault()
    const mode = e.detail === 2 ? SelectionMode.WORD
      : e.detail >= 3 ? SelectionMode.LINE : SelectionMode.NORMAL
    const anchor = mode === SelectionMode.WORD
      ? wordRangeAtPoint(timeline, e.clientX, e.clientY)
      : mode === SelectionMode.LINE
        ? lineRangeAtPoint(timeline, e.clientX, e.clientY)
        : rangeAtPoint(timeline, e.clientX, e.clientY)
    if (!anchor) return
    selectionDragRef.current = { mode, anchor: anchor.cloneRange(), x: e.clientX, y: e.clientY }
    if (mode !== SelectionMode.NORMAL) {
      timelineRangeRef.current = anchor
      setTimelineHighlight(anchor)
    }
  }

  useEffect(() => {
    if (!active) return undefined
    const onMouseMove = (e) => {
      const drag = selectionDragRef.current
      const timeline = scrollRef.current
      if (!drag || !timeline) return
      e.preventDefault()
      if (drag.mode === SelectionMode.NORMAL && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return
      const focus = drag.mode === SelectionMode.WORD
        ? wordRangeAtPoint(timeline, e.clientX, e.clientY)
        : drag.mode === SelectionMode.LINE
          ? lineRangeAtPoint(timeline, e.clientX, e.clientY)
          : rangeAtPoint(timeline, e.clientX, e.clientY)
      if (!focus || !drag.anchor.startContainer.isConnected) return
      const range = rangeFromAnchorToFocus(drag.anchor, focus, drag.mode)
      timelineRangeRef.current = range
      setTimelineHighlight(range)
    }
    const onMouseUp = () => { selectionDragRef.current = null }
    const onKeyDown = (e) => {
      const range = timelineRangeRef.current
      const input = inputRef.current
      if (!range || range.collapsed || !input) return
      const primary = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (e.key === 'Escape') { clearSelection(); return }
      if (primary && key === 'c') {
        if (document.activeElement !== input || input.selectionStart !== input.selectionEnd) return
        e.preventDefault(); e.stopPropagation()
        copyText(richTextFromRange(range, scrollRef.current))
        return
      }
      if (document.activeElement !== input) return
      const printable = e.key.length === 1 && !primary && !e.altKey
      const editingShortcut = primary && !e.altKey && ['a', 'v', 'x', 'y', 'z'].includes(key)
      const composing = e.isComposing || e.key === 'Process' || e.key === 'Dead'
      if (printable || editingShortcut || composing || EDITING_KEYS.has(e.key)) clearSelection()
    }
    document.addEventListener('mousemove', onMouseMove, true)
    document.addEventListener('mouseup', onMouseUp, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      selectionDragRef.current = null
      clearSelection()
      document.removeEventListener('mousemove', onMouseMove, true)
      document.removeEventListener('mouseup', onMouseUp, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [active, copyText])

  const prepareComposerPress = () => clearSelection()

  // `text` is the footer's composed message — the draft with its mentions already expanded
  const send = async (text) => {
    if (!text || sending) return
    setSending(true); setSendErr(null)
    // Redundant for a headless target, whose adapter now owns the note-reply default. Keep the explicit input
    // for compatibility; the server's shared prompt seam remains the sole policy and phrase owner.
    // The footer IS a Command Box, so it speaks the box's input kind: the durable append is the acceptance
    // and any `@new` child receipt rides back as the mention summary, shown in the composer's own line.
    const r = await sendSessionCommand(s.id, text, { replyVia: 'note' })
    setSending(false)
    if (r.ok) { setDraft(''); setSendNote(r.outcome?.mentionSummary || null); load() }
    else setSendErr(r.outcome?.error || t('mobile.sendFailed'))
  }

  const stop = async () => {
    if (stopping) return
    setStopping(true); setSendErr(null)
    const r = await interruptSession(s.id)
    setStopping(false)
    if (r.ok) load()
    else setSendErr(r.error || t('mobile.stopFailed'))
  }

  // who a `sent` event came from: null = the human; a session id resolves to its live headline when the
  // sender is still on the board, else its short id.
  const fromLabel = (from) => {
    if (!from) return t('mobile.you')
    const peer = sessions.find((x) => x.id === from)
    return peer ? sessionHeadline(peer) : from.slice(0, 8)
  }

  const toggleSeam = (seam) => {
    const seamId = seamKey(s.id, seam.from)
    const next = new Set(expandedSeams)
    if (next.has(seamId)) { next.delete(seamId); setExpandedSeams(next); return }
    next.add(seamId); setExpandedSeams(next)
    if (!(seam.open && seam.from === streamFrom)) void fetchTranscript(seam, seamId)
  }

  // THE RULER. Time lives in a left gutter, tabular and the same for every row, and the day it belongs to
  // sticks in that same gutter as the reader scrolls; the right edge carries nothing. At a narrow width the
  // gutter goes and each row keeps its own inline time instead.
  const rows = []
  let lastDay = null
  const dayRow = (ts, key) => {
    if (dayKey(ts) === lastDay) return
    lastDay = dayKey(ts)
    rows.push(<div className="m-day" key={`d${key}`}><div className="m-gut">{dayOf(ts)}</div><div className="m-day-rule" /></div>)
  }
  const gutter = (ts) => <div className="m-gut"><time>{timeOf(ts)}</time></div>
  const promptTs = s.created || detail?.created || events?.[0]?.ts
  if (detail?.prompt) {
    if (promptTs) dayRow(promptTs, 'p')
    rows.push(
      <div className="m-ev m-ev-prompt" key="prompt">
        {promptTs ? gutter(promptTs) : <div className="m-gut" />}
        <Quote ts={promptTs} text={detail.prompt} />
      </div>,
    )
  }
  for (const [i, item] of items.entries()) {
    dayRow(item.ts, i)
    if (item.kind === 'quote') {
      rows.push(
        <div className="m-ev m-ev-sent" key={i}>
          {gutter(item.ts)}
          <Quote who={item.from ? item.envelope?.label || fromLabel(item.from) : null} ts={item.ts} text={item.text} />
        </div>,
      )
    } else if (item.kind === 'say') {
      // THE AGENT IS THE PAGE. What it reported is the body — no well, no rule, no indent — with one small
      // status chip above saying in what state it said it. The chip is the whole trace of the machine.
      rows.push(
        <div className="m-ev m-ev-say" key={i}>
          {gutter(item.ts)}
          <article className="m-say">
            <div className="m-say-head">
              <span className="m-say-chip" style={{ color: STATUS_COLOR[item.status] }}>
                <span className="m-ev-glyph">{STATUS_GLYPH[item.status] || '·'}</span>
                <span className="m-ev-word">{t(`status.${item.status}`)}</span>
              </span>
              {item.text && !hasTimelineHighlight() && (
                <button type="button" className="m-copy-note" onClick={() => copyText(item.text)}>{t('mobile.copy')}</button>
              )}
              <time className="m-tin">{timeOf(item.ts)}</time>
            </div>
            {item.text && <div className="m-ev-note"><TimelineRichText>{item.text}</TimelineRichText></div>}
          </article>
        </div>,
      )
    } else if (item.kind === 'event') {
      // An error is something that HAPPENED, not a phase that lasted: one line, no duration. The old row
      // read `error 80h 45m` — the time since — as if it had been failing for eighty hours.
      rows.push(
        <div className="m-ev m-ev-line" key={i}>
          {gutter(item.ts)}
          <div className="m-line">
            <span className="m-ev-glyph" style={{ color: STATUS_COLOR[item.status] }}>{STATUS_GLYPH[item.status] || '·'}</span>
            <span className="m-ev-word" style={{ color: STATUS_COLOR[item.status] }}>{t(`status.${item.status}`)}</span>
            {item.text && <div className="m-line-text m-ev-note"><TimelineRichText>{item.text}</TimelineRichText></div>}
            <time className="m-tin">{timeOf(item.ts)}</time>
          </div>
        </div>,
      )
    } else {
      // THE SEAM. One line for everything between two messages, saying only how long the agent worked —
      // the one duration a reader asks scrollback for — and, once read, what that stretch cost. The tail
      // seam of a live session is the page's only moving thing; a tail seam of a dead one is the record's
      // last word, `working`, with no duration invented for a stretch nothing closed.
      const seamId = seamKey(s.id, item.from)
      const expanded = expandedSeams.has(seamId)
      const ticking = item.open && footerState === 'live'
      const streamed = item.open && item.from === streamFrom
      // the streaming seam reads its payload from the stream; every other seam from its interval read
      const transcript = streamed
        ? (tail === null ? { state: 'loading' } : tail.error ? { state: 'error', error: tail.error } : { state: 'ready', data: tail })
        : transcripts.get(seamId)
      const lead = ticking ? `${t('status.working')} · ${elapsed(Math.max(0, now - item.from))}`
        : item.open ? t('status.working')
          : `${t('mobile.worked')} ${elapsed(item.to - item.from)}`
      const calls = transcript?.state === 'ready'
        ? transcript.data.turns.reduce((n, turn) => n + (turn.tools?.length || 0), 0) : 0
      rows.push(
        <div className="m-ev m-ev-seam" key={i}>
          <div className="m-gut" />
          <div className="m-seam">
            <button type="button" className={`m-seam-row${ticking ? ' is-live' : ''}`} aria-expanded={expanded} onClick={() => toggleSeam(item)}>
              <span className="m-seam-lead">{lead}</span>
              {transcript?.state === 'ready' && (
                <span className="m-seam-detail">{transcript.data.turns.length} turns · {calls} tool uses</span>
              )}
              {/* the chevron TRAILS, as on every disclosure in the conversation: content first, one shape says open */}
              <Caret open={expanded} className="m-seam-caret" />
            </button>
            {expanded && (
              <div className="m-seam-inset">
                {transcript?.state === 'loading' && <div className="m-transcript-state">transcript 加载中…</div>}
                {transcript?.state === 'error' && <div className="m-transcript-state is-error">transcript 已不可用：{transcript.error}</div>}
                {transcript?.state === 'ready' && <TranscriptPayload data={transcript.data} live={streamed} />}
              </div>
            )}
            {/* THE LIVE TAIL: the open seam's collapsed face — the current turn, in the conversation's own
                grammar, from the same streamed payload the expanded seam shows in full */}
            {streamed && !expanded && <LiveTail key={seamId} data={tail} lastSaid={lastSaid} />}
          </div>
        </div>,
      )
    }
  }

  return (
    <div className="tl-chat">
      <div className="m-timeline" data-selectable ref={scrollRef} onScroll={onScroll}
        onMouseDown={beginTimelineSelection}>
        <div className="m-col" ref={timelineContentRef}>
          {events === null
            ? <div className="m-empty">{t('common.loading')}</div>
            : rows.length === 0 ? <div className="m-empty">{t('mobile.noEvents')}</div> : rows}
        </div>
      </div>
      {copyStatus && (
        <div className={`m-copy-status ${copyStatus}`} role="status" aria-live="polite" aria-atomic="true">
          {t(`mobile.${copyStatus === 'copied' ? 'copied' : 'copyFailed'}`)}
        </div>
      )}
      <TimelineFooter session={s} state={footerState} active={active} inputRef={inputRef} draft={draft} setDraft={setDraft}
        sending={sending} send={send} sendErr={sendErr} sendNote={sendNote} onRestore={onRestore} actionOutcome={actionOutcome}
        onComposerPress={prepareComposerPress} working={s.status === 'working'} stopping={stopping} stop={stop}
        specs={specs} sessions={sessions} boardCommands={boardCommands} />
    </div>
  )
}
