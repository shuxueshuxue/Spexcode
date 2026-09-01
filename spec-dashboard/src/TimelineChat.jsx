import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LiveTail, Quote, TranscriptView, elapsed, timeOf, useOpenInPlace } from '@spexcode/transcript-ui'
import { sessionHeadline, STATUS_COLOR, STATUS_GLYPH } from './session.js'
import { interruptSession, loadSessionTimeline, loadSessionDetail, loadSessionTranscript, loadSessionTranscriptTool, sendSessionCommand, subscribeSessionTranscript } from './data.js'
import { useT } from './i18n/index.jsx'
import { useIsMobile } from './useIsMobile.js'
import { richTextFromRange } from './RichText.js'
import 'katex/dist/katex.min.css'
import { ComposerSurface, ComposerTextarea, composingKey } from './Composer.jsx'
import { ContextMenu, ContextMenuGroup, ContextMenuItem } from './ContextMenu.jsx'
import SelectionAttachment from './SelectionAttachment.jsx'
import { encodePrompt } from './codeSelection.js'
import { useEscLayer } from './escStack.js'
import { Caret, Icon, IconButton } from './icons.jsx'
import { DashboardTranscriptUi, TimelineRichText } from './Transcript.jsx'
import { conversationItems } from './conversationItems.js'
import { readerIsSelecting } from './readerSelection.js'
import { useFoldOut } from './useFold.js'
import { boardCommandFor, expandMentions, typeTrigger, useMentionAutocomplete } from './mentions.jsx'
import { useAttachQueue } from './useAttachQueue.jsx'
import { useCommandPresets, useHarnessCommands, useLaunchers } from './launch.js'
import { inboxCommands } from './sessionCommands.js'

// a short date for the day separators the timeline inserts when the calendar day flips between
// neighbouring events; the row time itself is the transcript's (`timeOf`, @spexcode/transcript-ui).
const dayOf = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
const dayKey = (ts) => new Date(ts).toDateString()
// A ROW KNOWS WHEN IT WAS SAID. A quoted passage is addressed by its session and the moment it was said
// ([[code-selection]]'s timeline flavour), and a Range can only answer that by asking the row it landed in —
// so every row carries its own normalised moment. Null for a row with no usable timestamp, which is what
// makes the quote verb honestly unavailable there rather than silently inventing an address.
const atOf = (ts) => {
  const at = new Date(ts)
  return Number.isFinite(at.getTime()) ? at.toISOString() : null
}

const transcriptCache = new Map()
// ONE READ PER SESSION AT A TIME, held above the component because the callers that race are not all inside
// one instance: several effects ask on the same frame (mount, and the record's own status/note moving), and
// StrictMode mounts a twin that asks again before the first answer lands. The cursor is only known once an
// answer HAS landed, so without this they each set out with no cursor and each pays for a whole window.
const timelineInflight = new Map()

function transcriptKey(sessionId, from, to) { return `${sessionId}:${from}:${to}` }
// The interval end moves when a later event closes the seam; expansion belongs to the seam itself.
function seamKey(sessionId, from) { return `${sessionId}:${from}` }

// How much of the history a window holds at once, and the size of one step back through it.
const WINDOW = 200
// How long after a press a growth still counts as the reader's own. Opening is a React update and the
// observer fires on the next frame; the slack is for prose that lays out late (code, math, an image).
// Well under the poll, so a message landing in the same breath is still followed.
const READER_GROWTH_MS = 700
// A DECLARATION IS NOT A PAGE. Notes are authored prose and the longest of them run past a screen on their
// own, so a handful of them are the whole scroll. Past this height a note is clamped to a readable opening
// and says how to get the rest — the row keeps its place in the conversation either way. Under it, which is
// most of them, nothing changes: this folds the tail of the distribution, not the ordinary reading.
const NOTE_CLAMP = 400

function ClampedNote({ text }) {
  const t = useT()
  const bodyRef = useRef(null)
  const [overflows, setOverflows] = useState(false)
  const [open, setOpen] = useState(false)
  // measured, never guessed from the text's length: what matters is how tall it RENDERED, and rich text
  // (code, math, images) settles after the first paint — so the observer keeps the answer honest.
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return undefined
    const measure = () => setOverflows(el.scrollHeight > NOTE_CLAMP + 24)
    measure()
    if (typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])
  const clamped = overflows && !open
  // the same in-place open the quoted turn gets: what the reader pressed keeps its position
  const { ref: wrapRef, mark } = useOpenInPlace(open)
  // ONE GESTURE, THE SAME ONE THE QUOTED TURN TAKES ([[transcript-view]]'s clamped quote): what is hidden is
  // the block, so the block is what a reader presses, and `more` stays as the mark that says so rather than
  // as the only target. A press that ENDED A SELECTION is a reader taking the words, not asking for the rest.
  return (
    <div ref={wrapRef} className={`m-note-wrap${clamped ? ' is-clamped' : ''}`}
      onClick={clamped ? () => { if (!readerIsSelecting()) { mark(); setOpen(true) } } : undefined}>
      <div ref={bodyRef} className={`m-ev-note${clamped ? ' is-clamped' : ''}`}>
        <TimelineRichText>{text}</TimelineRichText>
      </div>
      {clamped && <button type="button" className="m-note-more" aria-expanded={false}>{t('mobile.more')}</button>}
    </div>
  )
}

// a re-seated window is usually the SAME history — keep the old array identity then, so nothing downstream
// (the pin effect above all) re-fires on a no-change tick. Append-only log: length + last entry decide.
const sameEvents = (a, b) => a != null && a.length === b.length
  && (a.length === 0 || JSON.stringify(a[a.length - 1]) === JSON.stringify(b[b.length - 1]))

// THE SECOND HAND IS ITS OWN COMPONENT. The open seam counts every second while the agent works, and that
// tick used to be state on the whole conversation: one number moved, and every row in the window — hundreds
// of them, each with its own rich text — was rebuilt to draw it. The count lives here now, so a working
// session redraws one line per second instead of its entire history. The clock is still the server's: the
// skew is read through a ref, so a fresh poll's correction reaches the next tick without re-rendering anyone.
const SeamElapsed = memo(function SeamElapsed({ from, skewRef }) {
  const [now, setNow] = useState(() => Date.now() + skewRef.current)
  useEffect(() => {
    const tick = () => { if (document.visibilityState !== 'hidden') setNow(Date.now() + skewRef.current) }
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [from, skewRef])
  return <>{elapsed(Math.max(0, now - from))}</>
})

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
  const line = element?.closest('.m-ev-note, .tx-quote-text')
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
function TimelineFooter({ session, state, active, inputRef, draft, setDraft, sending, send, sendErr, sendNote, onRestore, actionOutcome, onComposerPress, working = false, stopping = false, stop, specs = [], sessions = [], boardCommands = [], quotes = [], onRemoveQuote }) {
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
    // a quoted passage rides the SAME prompt as everything else ([[code-selection]]) — one ordinary message
    // with its tokens appended, never a second field or a second route.
    send(encodePrompt(expandMentions(raw, specs), quotes))
  }
  return (
    <ComposerSurface
      as="footer"
      className={`m-composer is-${state}${attach.dragging ? ' dragover' : ''}`}
      data-footer-state={state}
      {...attach.dropProps}
      preview={(quotes.length > 0 || sendErr || sendNote) && (
        <>
          {quotes.length > 0 && (
            <div className="m-quote-queue" aria-label={t('session.quoteAttachments')}>
              {quotes.map((quote, index) => (
                <SelectionAttachment key={`${quote.at}:${index}`} selection={quote}
                  onRemove={() => onRemoveQuote?.(index)} />
              ))}
            </div>
          )}
          {(sendErr || sendNote) && <div className={sendErr ? 'm-senderr' : 'm-sendnote'}>{sendErr || sendNote}</div>}
        </>
      )}
      editor={!readOnly && (
        <>
        <div className="m-composer-line fv-tawrap">
          <ComposerTextarea
            ref={inputRef}
            className="m-input"
            data-focus-sink={active && !readOnly ? '' : undefined}
            rows={1}
            placeholder={t('mobile.inputPlaceholder')}
            value={draft}
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
          {!readOnly && (
            <>
              {attach.fileInput}
              <div className="si-command-tools m-composer-tools">
                <span className="si-command-title"><Icon name="command" size={12} />{t('session.commandBox')}</span>
                <button type="button" className="fv-trigger-btn" data-tip={t('thread.mentionActor')} aria-label={t('thread.mentionActor')} onMouseDown={(e) => e.preventDefault()} onClick={() => insertTrigger('@')}>@</button>
                <button type="button" className="fv-trigger-btn" data-tip={t('thread.mentionNode')} aria-label={t('thread.mentionNode')} onMouseDown={(e) => e.preventDefault()} onClick={() => insertTrigger('[[')}>[[</button>
                <button type="button" className="fv-trigger-btn" data-tip={t('session.menuCommands')} aria-label={t('session.menuCommands')} onMouseDown={(e) => e.preventDefault()} onClick={() => insertTrigger('/')}>/</button>
                <IconButton icon={attach.busy ? 'loader' : 'paperclip'} size={14} iconClassName={attach.busy ? 'si-attach-busy' : undefined}
                  className="si-command-tool" label={t('session.attachTitle')} disabled={attach.busy} onClick={attach.pick} />
                {canStop && (
                  <IconButton icon="stop" size={12} className="m-stop" label={t('mobile.stop')} disabled={stopping}
                    onMouseDown={(e) => e.preventDefault()} onClick={stop} />
                )}
                <IconButton icon="send" size={14} className="m-send" label={t('mobile.send')}
                  disabled={!draft.trim() || sending} onMouseDown={(e) => e.preventDefault()} onClick={submit} />
              </div>
            </>
          )}
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
// A MOUNTED CONVERSATION IS A NEIGHBOUR, NOT A CHILD OF WHOEVER IS TYPING. The console keeps several of these
// mounted at once ([[session-console]]'s layers), and its own composers hold their draft text in the console's
// state — so without this gate one keystroke in the New prompt or the Command Box re-rendered every mounted
// timeline, and the cost of typing grew with how many sessions the reader had visited. Measured on this
// project's board: 3.8ms per character with none mounted, 593ms with twenty. The props below are referentially
// stable for a layer nobody is looking at, which is what makes the gate hold; the two that were not — a fresh
// `[]` for `boardCommands` and an inline `onRestore` — are stabilised at the call site.
function TimelineChat({ s, sessions = [], active = true, footerState = 'live', onRestore, actionOutcome, specs = [], boardCommands = [] }) {
  const t = useT()
  const isMobile = useIsMobile()
  const [events, setEvents] = useState(null)
  // WHERE THE WINDOW SITS. `offset` is how many earlier events the history holds that this window does not
  // show — the number the back-load button names, and the reason a long session no longer just ends at the
  // top. `stamp` is the log's sequence, which is what the poll asks growth against; `priorWorking` is the
  // word the events before the window already said ([[session-timeline]]).
  const [win, setWin] = useState({ stamp: null, offset: 0, total: 0, priorWorking: false })
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [detail, setDetail] = useState(null)   // the record detail — carries the full originating prompt
  const [draft, setDraft] = useState('')
  // the passages the reader has quoted into this draft, and the open timeline menu ({x, y, at}); `at` is
  // resolved when the menu OPENS, so an unaddressable passage shows the quote verb unavailable instead of
  // producing a token that points nowhere.
  const [quotes, setQuotes] = useState([])
  const [menu, setMenu] = useState(null)
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [sendErr, setSendErr] = useState(null)
  const [sendNote, setSendNote] = useState(null)   // the last send's child receipt (`@new`), if any
  const [copyStatus, setCopyStatus] = useState(null)
  const [expandedSeams, setExpandedSeams] = useState(() => new Set())
  const [transcripts, setTranscripts] = useState(() => new Map())
  const [tail, setTail] = useState(null)   // the open seam's streamed payload ([[session-transcript]]); null until the first frame
  const scrollRef = useRef(null)
  const timelineContentRef = useRef(null)
  const inputRef = useRef(null)
  const selectionDragRef = useRef(null)
  const timelineRangeRef = useRef(null)
  const copyStatusTimerRef = useRef(null)
  // A LIVE FRAME WITHHOLDS OUTPUT BODIES: a call opened in the open seam fetches its body once, by session and
  // interval, and the seam remembers it for as long as the session is on screen — reopening never refetches.
  const outputCacheRef = useRef(new Map())    // `${from}:${toolId}` → the fetch's promise
  const outputLoadersRef = useRef(new Map())  // seam start → its stable loader (a context value that never churns)
  const loaderFor = (from) => {
    let loader = outputLoadersRef.current.get(from)
    if (!loader) {
      loader = (toolId) => {
        const key = `${from}:${toolId}`
        let pending = outputCacheRef.current.get(key)
        if (!pending) { pending = loadSessionTranscriptTool(s.id, from, toolId); outputCacheRef.current.set(key, pending) }
        return pending.then((result) => (result.ok ? { ok: true, output: result.data?.output ?? null } : { ok: false, error: result.error }))
      }
      outputLoadersRef.current.set(from, loader)
    }
    return loader
  }
  // THE OPEN TAIL'S INTERVAL ENDS AT THE LATEST POLL, and that end is a REF, not state. It addresses the
  // transcript of a seam that has no close yet; a live one reads its transcript from the stream instead, so
  // this end moves nothing on screen by itself and has no business re-rendering the conversation to change.
  const pollNowRef = useRef(Date.now())
  const skewRef = useRef(0)   // server clock minus ours, re-read on every timeline response
  // an open seam has no end of its own ([[session-timeline]]'s derivation leaves it undefined) — whoever
  // needs an interval for it says which present it ends at
  const seamEnd = useCallback((seam) => (seam.open ? Math.max(seam.from + 1, pollNowRef.current) : seam.to), [])
  const inflightRef = useRef(new Set())   // transcript keys being read right now
  const wantedRef = useRef(new Map())     // seamId → the interval key it currently maps to
  const cachedKeyRef = useRef(new Map())  // seamId → the last key the module cache holds for it
  const pinnedRef = useRef(true)   // is the reader at the newest entry? Only then does a refresh follow it.

  // THE POLL ASKS FOR GROWTH, NOT FOR THE HISTORY. An append-only log has a sequence, so a reader that
  // holds a window says how far it has read and gets back only what came after — usually nothing at all,
  // and then the held array keeps its identity and not one row is rebuilt. The server answers a reader too
  // far behind with a whole window instead (it carries `offset`), which is seated rather than appended;
  // that is also the FIRST read, which asks with no cursor.
  const stampRef = useRef(null)
  const load = useCallback(() => {
    const joined = timelineInflight.get(s.id)
    if (joined) return joined
    const since = stampRef.current
    const read = loadSessionTimeline(s.id, since === null ? { limit: WINDOW } : { since, limit: WINDOW }).then((d) => {
      if (!d) return
      if (Number.isFinite(d.serverNow)) skewRef.current = d.serverNow - Date.now()
      pollNowRef.current = Date.now() + skewRef.current
      stampRef.current = d.stamp ?? stampRef.current
      if (d.offset !== undefined) {
        setWin({ stamp: d.stamp, offset: d.offset, total: d.total, priorWorking: !!d.priorWorking })
        setEvents((prev) => (sameEvents(prev, d.events) ? prev : d.events))
        return
      }
      if (d.events.length === 0) { setWin((prev) => (prev.stamp === d.stamp ? prev : { ...prev, stamp: d.stamp })); return }
      setWin((prev) => ({ ...prev, stamp: d.stamp, total: (prev.total || 0) + d.events.length }))
      setEvents((prev) => (prev ? [...prev, ...d.events] : d.events))
    }).finally(() => { timelineInflight.delete(s.id) })
    timelineInflight.set(s.id, read)
    return read
  }, [s.id])

  // WALKING BACK. The window names how much earlier history it is not showing; this is the reader taking
  // one page of it. The page is prepended and the scroll is anchored to the row that was under the thumb
  // (below), so reading position survives the growth instead of jumping to a new top.
  const anchorRef = useRef(null)
  const loadEarlier = useCallback(() => {
    if (loadingEarlier || !win.offset) return
    setLoadingEarlier(true)
    const timeline = scrollRef.current
    anchorRef.current = timeline ? { height: timeline.scrollHeight, top: timeline.scrollTop } : null
    void loadSessionTimeline(s.id, { before: win.offset, limit: WINDOW }).then((d) => {
      if (d && d.events.length) {
        setWin((prev) => ({ ...prev, offset: d.offset ?? 0, total: d.total ?? prev.total, priorWorking: !!d.priorWorking }))
        setEvents((prev) => (prev ? [...d.events, ...prev] : d.events))
      } else anchorRef.current = null
      setLoadingEarlier(false)
    })
  }, [s.id, win.offset, loadingEarlier])
  useEffect(() => {
    setEvents(null); setWin({ stamp: null, offset: 0, total: 0, priorWorking: false }); setLoadingEarlier(false); stampRef.current = null; anchorRef.current = null; setDetail(null); setCopyStatus(null); setSendNote(null); setExpandedSeams(new Set()); setTranscripts(new Map()); inflightRef.current.clear(); wantedRef.current.clear(); cachedKeyRef.current.clear(); outputCacheRef.current.clear(); outputLoadersRef.current.clear(); setTail(null); tailForRef.current = null; paintedRef.current = false; setWaited(false); pollNowRef.current = Date.now(); pinnedRef.current = true; setQuotes([]); setMenu(null)
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
        && input && input.offsetParent !== null && getComputedStyle(input).visibility !== 'hidden'
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

  const items = useMemo(() => conversationItems(events || [], win.priorWorking), [events, win.priorWorking])
  // THE OPEN SEAM STREAMS. A working record ends in an open seam; while the session is live that seam
  // subscribes to its interval's stream — the server advances the native thread only when it changed and
  // pushes what changed, merged by turn id in the subscriber — so the collapsed live tail and the expanded transcript are one
  // read, refreshed the instant the agent acts rather than on the next poll. The seam's start is the
  // subscription's identity: a later message opens a new seam and a new stream.
  const openSeam = items.length && items[items.length - 1].kind === 'seam' && items[items.length - 1].open ? items[items.length - 1] : null
  const streamFrom = active && footerState === 'live' && openSeam ? openSeam.from : null
  // THE TAIL SURVIVES DESELECTION. Leaving the tab closes the stream (a hidden pane reads nothing), but the
  // last payload stays held: coming back draws the tail at once, from what was last seen, and the reopened
  // stream's first `full` frame replaces it in place. Clearing it only when the SEAM changes is what keeps a
  // return from blinking the tail away and back. A new seam (a later message) starts from nothing.
  const tailForRef = useRef(null)   // the seam start the held tail belongs to
  useEffect(() => {
    if (streamFrom === null) return undefined
    if (tailForRef.current !== streamFrom) { tailForRef.current = streamFrom; setTail(null) }
    return subscribeSessionTranscript(s.id, streamFrom, setTail)
  }, [s.id, streamFrom])
  // THE TAIL TRAVELS TO ITS ROW. A message — the person's, or the agent's own note — closes the stretch it
  // lands in, and the seam that was `working · 4m 12s` with its tail underneath becomes one `worked 4m 12s`
  // line. That used to happen in a single frame: the payload belongs to the seam that is streaming, so the
  // instant the next seam took the stream over, the tail it replaced was simply not drawn. The fold is now
  // the same movement the transcript's own work folds with ([[transcript-view]]'s `.tx-fold`), and this is
  // the half that makes it visible — the outgoing seam's tail is held, with the props it was drawn from, for
  // exactly one panel fold and no longer.
  const foldingTail = useFoldOut(streamFrom, { turns: tail?.turns, revision: tail?.revision })
  // ONE FIRST PAINT. The record and the open seam's stream arrive on two clocks — the timeline read lands,
  // then a few hundred milliseconds later the first frame — and painting the rows first put the tail in a
  // second paint that pushed the page. The first paint of a session waits for its tail (bounded, 600ms);
  // after that the rows never wait again: a later seam draws into a page already on screen.
  const paintedRef = useRef(false)
  const [waited, setWaited] = useState(false)
  const holdingFirstPaint = !paintedRef.current && events !== null && streamFrom !== null && tail === null && !waited
  useEffect(() => {
    if (!holdingFirstPaint) return undefined
    const timer = setTimeout(() => setWaited(true), 600)
    return () => clearTimeout(timer)
  }, [holdingFirstPaint])
  if (events !== null && !holdingFirstPaint) paintedRef.current = true
  // what the agent most recently SAID on the record — the live tail elides a note the record already carries
  const lastSaid = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'say' && items[i].text) return items[i].text
    return null
  }, [items])

  const fetchTranscript = useCallback(async (seam, seamId) => {
    const to = seamEnd(seam)
    const key = transcriptKey(s.id, seam.from, to)
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
    const result = await loadSessionTranscript(s.id, seam.from, to)
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
  }, [s.id, seamEnd])

  // A later event changes only the seam's interval, never the user's disclosure choice. Refresh the
  // expanded seam against that new interval while keeping it open.
  useEffect(() => {
    if (!active || !events) return undefined
    for (const seam of items) {
      if (seam.kind !== 'seam' || (seam.open && seam.from === streamFrom)) continue
      const seamId = seamKey(s.id, seam.from)
      if (!expandedSeams.has(seamId)) continue
      const key = transcriptKey(s.id, seam.from, seamEnd(seam))
      const current = transcripts.get(seamId)
      if (current?.transcriptKey === key || inflightRef.current.has(key)) continue
      void fetchTranscript(seam, seamId)
    }
    return undefined
  }, [active, events, items, expandedSeams, fetchTranscript, s.id, transcripts, streamFrom, seamEnd])
  // chat-style pinning that respects the thumb: follow new entries only while the reader is already at
  // the bottom — a reader parked up in history is never yanked down by a poll.
  const followTimelineTail = useCallback(() => {
    const timeline = scrollRef.current
    if (anchorRef.current) return   // a page is arriving at the TOP; the anchor above owns this frame
    if (timeline && pinnedRef.current) timeline.scrollTop = timeline.scrollHeight
  }, [])
  // THE TAIL FOLLOWS MESSAGES, NOT THE READER'S OWN HAND. The observer below exists so content that settles
  // late — a transcript frame, an image finishing — still carries a pinned reader to the newest entry. But
  // a reader OPENING something is a height change too, and being thrown to the bottom for it is the opposite
  // of what they asked for: what they opened has to stay where it was, and grow downward from there. A press
  // marks the moment, so growth just after one is read as the reader's own rather than as new mail arriving.
  const readerPressedAtRef = useRef(0)
  const notePress = useCallback(() => { readerPressedAtRef.current = Date.now() }, [])
  const followUnlessReaderGrewIt = useCallback(() => {
    if (Date.now() - readerPressedAtRef.current < READER_GROWTH_MS) return
    followTimelineTail()
  }, [followTimelineTail])
  const onScroll = () => { const el = scrollRef.current; if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48 }
  // GROWTH AT THE TOP MOVES NOTHING. Prepending a page pushes everything below it down by exactly the height
  // that arrived; adding that height back to the scroll leaves the row the reader was on where it was. This
  // runs before the tail-follow below and consumes the anchor, so a back-load is never also a jump to the end.
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const timeline = scrollRef.current
    if (!anchor || !timeline) return
    anchorRef.current = null
    timeline.scrollTop = anchor.top + (timeline.scrollHeight - anchor.height)
  }, [events])
  useLayoutEffect(followTimelineTail, [events, followTimelineTail])
  useLayoutEffect(() => {
    if (!active || typeof ResizeObserver !== 'function') return undefined
    const content = timelineContentRef.current
    if (!content) return undefined
    const observer = new ResizeObserver(followUnlessReaderGrewIt)
    observer.observe(content)
    return () => observer.disconnect()
  }, [active, followUnlessReaderGrewIt])

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

  // THE TIMELINE'S OWN MENU. The console suppresses the native menu nowhere by default ([[session-console]]),
  // and the one sanctioned exception is a surface that has a menu to put in its place — which is true here
  // only while a passage is actually selected. With nothing selected the press stays the browser's, so copy,
  // search and inspect over ordinary conversation text are untouched. The timeline's selection is a painted
  // Highlight rather than a document Selection, so the native menu could never have acted on it anyway; this
  // is what gives that selection its verbs. A right-click does not retire the selection — `beginTimelineSelection`
  // answers only to the primary button — so the menu opens on a passage that is still there.
  const onTimelineContextMenu = (event) => {
    const range = timelineRangeRef.current
    if (!range || range.collapsed) return
    event.preventDefault()
    const start = range.startContainer
    const host = start?.nodeType === 1 ? start : start?.parentElement
    setMenu({ x: event.clientX, y: event.clientY + 4, at: host?.closest?.('[data-at]')?.getAttribute('data-at') || null })
  }
  const closeMenu = useCallback(() => setMenu(null), [])
  useEscLayer(!!menu, closeMenu)
  useEffect(() => {
    if (!menu) return undefined
    const onClick = () => closeMenu()
    const onContext = () => closeMenu()
    window.addEventListener('click', onClick)
    window.addEventListener('contextmenu', onContext, true)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('contextmenu', onContext, true)
    }
  }, [menu, closeMenu])

  // COPY LEAVES, QUOTE STAYS. Copy hands the passage to the clipboard and the reader is on their own with it;
  // quote hands it to the composer below as the ordinary attachment every other selection surface uses
  // ([[selection-attachment]]), so the next thing typed is a reply the agent can read the referent of. It is
  // the same verb prose dispatch already offers a spec passage — this surface just does not have to ask who
  // receives it, because it is already standing in the session it is quoting.
  const copySelection = () => {
    const range = timelineRangeRef.current
    if (range && !range.collapsed) copyText(richTextFromRange(range, scrollRef.current))
    closeMenu()
  }
  const quoteSelection = () => {
    const range = timelineRangeRef.current
    const at = menu?.at
    if (!range || range.collapsed || !at) { closeMenu(); return }
    const text = richTextFromRange(range, scrollRef.current)
    closeMenu()
    if (!text) return
    setQuotes((prev) => [...prev, { session: s.id, at, text }])
    clearSelection()
    inputRef.current?.focus()
  }

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
    if (r.ok) { setDraft(''); setQuotes([]); setSendNote(r.outcome?.mentionSummary || null); load() }
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

  // THE RULER. Time lives in a tabular gutter shared by ordinary rows. User quotes are right-aligned, so
  // their gutter follows the bubble on the right; at a narrow width the gutter goes and each row keeps its
  // own inline time instead.
  const rows = []
  let lastDay = null
  const dayRow = (ts, key) => {
    if (dayKey(ts) === lastDay) return
    lastDay = dayKey(ts)
    rows.push(<div className="m-day" key={`d${key}`}><div className="m-day-rule" /><span className="m-day-label">{dayOf(ts)}</span></div>)
  }
  const gutter = (ts) => <div className="m-gut"><time>{timeOf(ts)}</time></div>
  const promptTs = s.created || detail?.created || events?.[0]?.ts
  if (detail?.prompt) {
    if (promptTs) dayRow(promptTs, 'p')
    rows.push(
      <div className="m-ev m-ev-prompt" key="prompt" data-at={atOf(promptTs)}>
        <Quote ts={promptTs} text={detail.prompt} />
        {promptTs ? gutter(promptTs) : <div className="m-gut" />}
      </div>,
    )
  }
  // WHAT THE WINDOW IS NOT SHOWING, SAID WHERE IT IS MISSING FROM. The count belongs at the SEAM in the
  // reading — after the originating prompt, which is the session's first word and always drawn, and before
  // the window's oldest row. Put at the top of the column instead it sat ABOVE the prompt, so a reader who
  // scrolled up met that unchanging first word every time and could not tell the window had moved at all;
  // the jump it hides (a prompt on one day, the window opening on another) is exactly here.
  if (events !== null && !holdingFirstPaint && win.offset > 0) {
    rows.push(
      <button type="button" className="m-earlier" key="earlier" onClick={loadEarlier} disabled={loadingEarlier}>
        <Caret open={false} className="m-earlier-caret" />
        {loadingEarlier ? t('common.loading') : t('mobile.loadEarlier', { count: win.offset })}
      </button>,
    )
  }
  for (const [i, item] of items.entries()) {
    dayRow(item.ts, i)
    if (item.kind === 'quote') {
      rows.push(
        <div className="m-ev m-ev-sent" key={i} data-at={atOf(item.ts)}>
          <Quote who={item.from ? item.envelope?.label || fromLabel(item.from) : null} ts={item.ts} text={item.text} />
          {gutter(item.ts)}
        </div>,
      )
    } else if (item.kind === 'say') {
      // THE AGENT IS THE PAGE. What it reported is the body — no well, no rule, no indent — with one small
      // status chip above saying in what state it said it. The chip is the whole trace of the machine.
      rows.push(
        <div className="m-ev m-ev-say" key={i} data-at={atOf(item.ts)}>
          <div className="m-gut" />
          <article className="m-say">
            <div className="m-say-head">
              <time className="m-line-time">{timeOf(item.ts)}</time>
              <span className="m-say-chip" style={{ color: STATUS_COLOR[item.status] }}>
                <span className="m-ev-glyph">{STATUS_GLYPH[item.status] || '·'}</span>
                <span className="m-ev-word">{t(`status.${item.status}`)}</span>
              </span>
              {item.text && !hasTimelineHighlight() && (
                <button type="button" className="m-copy-note" onClick={() => copyText(item.text)}>{t('mobile.copy')}</button>
              )}
            </div>
            {item.text && <ClampedNote text={item.text} />}
          </article>
        </div>,
      )
    } else if (item.kind === 'event') {
      // An event is something that HAPPENED, not a phase that lasted: one line with its timestamp inline.
      rows.push(
        <div className="m-ev m-ev-line" key={i} data-at={atOf(item.ts)}>
          <div className="m-gut" />
          <div className="m-line">
            <time className="m-line-time">{timeOf(item.ts)}</time>
            <span className="m-ev-glyph" style={{ color: STATUS_COLOR[item.status] }}>{STATUS_GLYPH[item.status] || '·'}</span>
            <span className="m-ev-word" style={{ color: STATUS_COLOR[item.status] }}>{t(`status.${item.status}`)}</span>
            {item.text && <div className="m-line-text"><ClampedNote text={item.text} /></div>}
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
      // the stretch this message just closed, for as long as its tail is still on its way down
      const collapsing = !!foldingTail && item.from === foldingTail.key
      // the streaming seam reads its payload from the stream; every other seam from its interval read
      const transcript = streamed
        ? (tail === null ? { state: 'loading' } : tail.error ? { state: 'error', error: tail.error } : { state: 'ready', data: tail })
        : transcripts.get(seamId)
      const lead = item.open ? t('status.working') : `${t('mobile.worked')} ${elapsed(item.to - item.from)}`
      const calls = transcript?.state === 'ready'
        ? transcript.data.turns.reduce((n, turn) => n + (turn.tools?.length || 0), 0) : 0
      rows.push(
        <div className="m-ev m-ev-seam" key={i} data-at={atOf(item.ts)}>
          <div className="m-gut" />
          <div className={`m-seam${collapsing ? ' is-folding' : ''}`}>
            <button type="button" className={`m-seam-row${ticking ? ' is-live' : ''}`} aria-expanded={expanded} onClick={() => toggleSeam(item)}>
              <span className="m-seam-lead">{lead}{ticking && <> · <SeamElapsed from={item.from} skewRef={skewRef} /></>}</span>
              {transcript?.state === 'ready' && (
                <span className="m-seam-detail">{transcript.data.turns.length} turns · {calls} tool uses</span>
              )}
              {/* the chevron TRAILS, as on every disclosure in the conversation: content first, one shape says open */}
              <Caret open={expanded} className="m-seam-caret" />
            </button>
            <DashboardTranscriptUi loadToolOutput={loaderFor(item.from)}>
              {expanded && (
                <div className="m-seam-inset">
                  {transcript?.state === 'loading' && <div className="m-transcript-state">transcript 加载中…</div>}
                  {transcript?.state === 'error' && <div className="m-transcript-state is-error">transcript 已不可用：{transcript.error}</div>}
                  {transcript?.state === 'ready' && <TranscriptView data={transcript.data} live={streamed} />}
                </div>
              )}
              {/* THE LIVE TAIL: the open seam's collapsed face — the current turn, in the conversation's own
                  grammar, from the same streamed payload the expanded seam shows in full. It folds away
                  inside the transcript package's own fold wrapper, so the close travels the height between
                  the tail and the row instead of dropping it; `tx` is on the wrapper because that class is
                  where the package keeps the duration this movement reads. */}
              {(streamed || collapsing) && !expanded && (
                <div className={`tx tx-fold${collapsing ? ' is-closing' : ''}`}>
                  <LiveTail key={seamId} lastSaid={lastSaid}
                    {...(collapsing ? foldingTail.value : { turns: tail?.turns, revision: tail?.revision })} />
                </div>
              )}
            </DashboardTranscriptUi>
          </div>
        </div>,
      )
    }
  }

  return (
    <DashboardTranscriptUi>
    <div className="tl-chat">
      <div className="m-timeline" data-selectable ref={scrollRef} onScroll={onScroll}
        onClickCapture={notePress}
        onMouseDown={beginTimelineSelection} onContextMenu={onTimelineContextMenu}>
        <div className="m-col" ref={timelineContentRef}>
          {events === null || holdingFirstPaint
            ? <div className="m-empty">{t('common.loading')}</div>
            : rows.length === 0 ? <div className="m-empty">{t('mobile.noEvents')}</div> : rows}
        </div>
      </div>
      {copyStatus && (
        <div className={`m-copy-status ${copyStatus}`} role="status" aria-live="polite" aria-atomic="true">
          {t(`mobile.${copyStatus === 'copied' ? 'copied' : 'copyFailed'}`)}
        </div>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} anchorKey={`${menu.x}:${menu.y}`} label={t('mobile.selectionMenu')}>
          <ContextMenuGroup>
            <ContextMenuItem icon="copy" onClick={copySelection}>{t('mobile.copy')}</ContextMenuItem>
            <ContextMenuItem icon="corner-up-left" disabled={!menu.at} onClick={quoteSelection}>{t('mobile.quote')}</ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenu>
      )}
      <TimelineFooter session={s} state={footerState} active={active} inputRef={inputRef} draft={draft} setDraft={setDraft}
        quotes={quotes} onRemoveQuote={(index) => setQuotes((prev) => prev.filter((_, n) => n !== index))}
        sending={sending} send={send} sendErr={sendErr} sendNote={sendNote} onRestore={onRestore} actionOutcome={actionOutcome}
        onComposerPress={prepareComposerPress} working={s.status === 'working'} stopping={stopping} stop={stop}
        specs={specs} sessions={sessions} boardCommands={boardCommands} />
    </div>
    </DashboardTranscriptUi>
  )
}

export default memo(TimelineChat)
