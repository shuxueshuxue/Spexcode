import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { sessionHeadline, STATUS_COLOR, STATUS_GLYPH } from './session.js'
import { loadSessionTimeline, loadSessionDetail, loadSessionTranscript, sendSessionText } from './data.js'
import { useT } from './i18n/index.jsx'
import { inertChromePress } from './focus.js'
import { useIsMobile } from './useIsMobile.js'
import RichText, { richTextFromRange } from './RichText.js'
import 'katex/dist/katex.min.css'
import { ComposerTextarea, composingKey } from './Composer.jsx'
import ExecutionTrace from './ExecutionTrace.jsx'

// hour:minute for an event row; a short date for the day separators the timeline inserts when the
// calendar day flips between neighbouring events.
const timeOf = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const dayOf = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
const dayKey = (ts) => new Date(ts).toDateString()
const epochOf = (ts) => typeof ts === 'number' ? ts : Date.parse(ts)

const transcriptCache = new Map()

function transcriptKey(sessionId, from, to) { return `${sessionId}:${from}:${to}` }

function TranscriptPayload({ data }) {
  if (!data?.turns?.length) return <div className="m-transcript-empty">transcript 已读取：该区间没有 turn</div>
  return <div className="m-transcript-flow">
    {data.turns.map((turn, index) => (
      <div className={`m-transcript-turn is-${turn.role}`} key={`${turn.id || turn.at}-${index}`}>
        <div className="m-transcript-role">{turn.role}</div>
        {turn.text && <div className="m-transcript-text"><RichText>{turn.text}</RichText></div>}
        {turn.tools?.map((tool) => (
          <details className="m-transcript-tool" key={tool.id}>
            <summary><span>{tool.name}</span><span>▸ 输出 {tool.outputLines || 0} 行</span></summary>
            <pre>{tool.output || '无输出'}</pre>
          </details>
        ))}
      </div>
    ))}
    {data.truncated && <div className="m-transcript-truncated">transcript 已截断：省略 {data.omittedTurns || 0} turns、{data.omittedBytes || 0} bytes</div>}
  </div>
}

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

function TimelineFooter({ state, active, inputRef, draft, setDraft, sending, send, sendErr, onRestore, actionOutcome, onComposerPress }) {
  const t = useT()
  const readOnly = state !== 'live'
  return (
    <footer className={`m-composer is-${state}`} data-footer-state={state}>
      {sendErr && <div className="m-senderr">{sendErr}</div>}
      <div className="m-composer-line">
        <ComposerTextarea
          ref={inputRef}
          className="m-input"
          data-focus-sink={active && !readOnly ? '' : undefined}
          rows={1}
          placeholder={t('mobile.inputPlaceholder')}
          value={draft}
          disabled={readOnly}
          onMouseDownCapture={onComposerPress}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (!readOnly && e.key === 'Enter' && !e.shiftKey && !composingKey(e)) {
              e.preventDefault(); e.stopPropagation(); send()
            }
          }}
        />
        <button className="m-send" disabled={readOnly || !draft.trim() || sending} onClick={send}>{t('mobile.send')}</button>
      </div>
      {readOnly && (
        <div className="m-coldline">
          <span>{t(state === 'archived' ? 'session.archivedReadOnly' : 'session.offlineReadOnly')}</span>
          <button type="button" className="m-coldline-action" disabled={actionOutcome?.phase === 'pending'} onClick={onRestore}>
            {t(state === 'archived' ? 'session.shelfRestore' : 'session.relaunch')}
          </button>
        </div>
      )}
      {readOnly && actionOutcome && (
        <div className={`si-action-outcome ${actionOutcome.phase}`} role={actionOutcome.phase === 'failed' ? 'alert' : 'status'}>
          {actionOutcome.message}
        </div>
      )}
    </footer>
  )
}

export default function TimelineChat({ s, sessions = [], active = true, footerState = 'live', onRestore, actionOutcome }) {
  const t = useT()
  const isMobile = useIsMobile()
  const [events, setEvents] = useState(null)
  const [detail, setDetail] = useState(null)   // the record detail — carries the full originating prompt
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendErr, setSendErr] = useState(null)
  const [copyStatus, setCopyStatus] = useState(null)
  const [expandedStatuses, setExpandedStatuses] = useState(() => new Set())
  const [transcripts, setTranscripts] = useState(() => new Map())
  const scrollRef = useRef(null)
  const timelineContentRef = useRef(null)
  const inputRef = useRef(null)
  const selectionDragRef = useRef(null)
  const timelineRangeRef = useRef(null)
  const copyStatusTimerRef = useRef(null)
  const transcriptNowRef = useRef(Date.now())
  const pinnedRef = useRef(true)   // is the reader at the newest entry? Only then does a refresh follow it.

  const load = useCallback(() => loadSessionTimeline(s.id).then((d) => {
    if (d) setEvents((prev) => (sameEvents(prev, d.events) ? prev : d.events))
  }), [s.id])
  useEffect(() => {
    if (!active) return undefined
    setEvents(null); setDetail(null); setCopyStatus(null); setExpandedStatuses(new Set()); setTranscripts(new Map()); transcriptNowRef.current = Date.now(); pinnedRef.current = true
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
    if (e.button !== 0 || !timeline || !(target instanceof Element)) return
    const control = target.closest(SELECTION_CONTROLS)
    if (control && timeline.contains(control)) return
    if (target === timeline) {
      const rect = timeline.getBoundingClientRect()
      if (e.clientX - rect.left - timeline.clientLeft >= timeline.clientWidth
        || e.clientY - rect.top - timeline.clientTop >= timeline.clientHeight) return
    }
    const mode = e.detail === 1 ? SelectionMode.NORMAL
      : e.detail === 2 ? SelectionMode.WORD
        : e.detail === 3 ? SelectionMode.LINE : null
    if (mode === null) return
    const anchor = mode === SelectionMode.WORD
      ? wordRangeAtPoint(timeline, e.clientX, e.clientY)
      : mode === SelectionMode.LINE
        ? lineRangeAtPoint(timeline, e.clientX, e.clientY)
        : rangeAtPoint(timeline, e.clientX, e.clientY)
    if (!anchor) return
    clearSelection()
    e.preventDefault()
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

  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true); setSendErr(null)
    // Redundant for a headless target, whose adapter now owns the note-reply default. Keep the explicit input
    // for compatibility; the server's shared prompt seam remains the sole policy and phrase owner.
    const r = await sendSessionText(s.id, text, { replyVia: 'note' })
    setSending(false)
    if (r.ok) { setDraft(''); load() }
    else setSendErr(r.error || t('mobile.sendFailed'))
  }

  // who a `sent` event came from: null = the human; a session id resolves to its live headline when the
  // sender is still on the board, else its short id.
  const fromLabel = (from) => {
    if (!from) return t('mobile.you')
    const peer = sessions.find((x) => x.id === from)
    return peer ? sessionHeadline(peer) : from.slice(0, 8)
  }

  const toggleTranscript = async (event, to) => {
    const from = epochOf(event.ts)
    const key = transcriptKey(s.id, from, to)
    const next = new Set(expandedStatuses)
    if (next.has(key)) { next.delete(key); setExpandedStatuses(next); return }
    next.add(key); setExpandedStatuses(next)
    const cached = transcriptCache.get(key)
    if (cached) { setTranscripts((previous) => new Map(previous).set(key, cached)); return }
    const pending = { state: 'loading' }
    transcriptCache.set(key, pending)
    setTranscripts((previous) => new Map(previous).set(key, pending))
    const result = await loadSessionTranscript(s.id, from, to)
    const value = result.ok ? { state: 'ready', data: result.data } : { state: 'error', error: result.error }
    transcriptCache.set(key, value)
    setTranscripts((previous) => new Map(previous).set(key, value))
  }

  // day-separated render list, oldest first (the wire order)
  const rows = []
  let lastDay = null
  for (const [i, e] of (events || []).entries()) {
    if (dayKey(e.ts) !== lastDay) { lastDay = dayKey(e.ts); rows.push(<div className="m-day" key={`d${i}`}>{dayOf(e.ts)}</div>) }
    if (e.kind === 'status') {
      const d = e.display || e.status
      const nextStatus = (events || []).slice(i + 1).find((candidate) => candidate.kind === 'status')
      const transcriptFrom = epochOf(e.ts)
      const transcriptTo = nextStatus ? epochOf(nextStatus.ts) : Math.max(transcriptFrom + 1, transcriptNowRef.current)
      const transcriptId = transcriptKey(s.id, transcriptFrom, transcriptTo)
      const transcript = transcripts.get(transcriptId)
      const expanded = expandedStatuses.has(transcriptId)
      const scale = transcript?.state === 'ready'
        ? `${transcript.data.turns.length} turns · ${transcript.data.turns.reduce((count, turn) => count + (turn.tools?.length || 0), 0)} tools`
        : 'transcript'
      rows.push(
        <div className="m-ev" key={i}>
          <div className="m-ev-head">
            <span className="m-ev-glyph" style={{ color: STATUS_COLOR[d] }}>{STATUS_GLYPH[d] || '·'}</span>
            <span className="m-ev-word" style={{ color: STATUS_COLOR[d] }}>{t(`status.${d}`)}</span>
            <span className="m-ev-time">{timeOf(e.ts)}</span>
          </div>
          <button type="button" className="m-transcript-toggle" aria-expanded={expanded} onClick={() => toggleTranscript(e, transcriptTo)}>
            <span>{expanded ? '▾' : '▸'} {scale}</span>
          </button>
          {expanded && transcript?.state === 'loading' && <div className="m-transcript-state">transcript 加载中…</div>}
          {expanded && transcript?.state === 'error' && <div className="m-transcript-state is-error">transcript 已不可用：{transcript.error}</div>}
          {expanded && transcript?.state === 'ready' && <TranscriptPayload data={transcript.data} />}
          {e.note && (
            <div className="m-ev-note">
              <RichText>{e.note}</RichText>
              {!hasTimelineHighlight() && (
                <button type="button" className="m-copy-note" onClick={() => copyText(e.note)}>
                  {t('mobile.copy')}
                </button>
              )}
            </div>
          )}
        </div>,
      )
    } else {
      rows.push(
        <div className="m-ev m-ev-sent" key={i}>
          <div className="m-ev-head">
            <span className="m-ev-from">{fromLabel(e.from)}</span>
            <span className="m-ev-time">{timeOf(e.ts)}</span>
          </div>
          <div className="m-ev-text"><RichText>{e.text}</RichText></div>
        </div>,
      )
    }
  }

  return (
    <div className="tl-chat">
      <div className="m-timeline" ref={scrollRef} onScroll={onScroll}
        onMouseDownCapture={inertChromePress} onMouseDown={beginTimelineSelection}>
        <div ref={timelineContentRef}>
          {detail?.prompt && (
            <details className="m-ev m-ev-prompt">
              <summary>{t('mobile.asked')}{s.created ? ` · ${dayOf(s.created)} ${timeOf(s.created)}` : ''}</summary>
              <div className="m-ev-text"><RichText>{detail.prompt}</RichText></div>
            </details>
          )}
          {events === null
            ? <div className="m-empty">{t('common.loading')}</div>
            : rows.length === 0 ? <div className="m-empty">{t('mobile.noEvents')}</div> : rows}
          <ExecutionTrace sessionId={s.id} active={active} />
        </div>
      </div>
      {copyStatus && (
        <div className={`m-copy-status ${copyStatus}`} role="status" aria-live="polite" aria-atomic="true">
          {t(`mobile.${copyStatus === 'copied' ? 'copied' : 'copyFailed'}`)}
        </div>
      )}
      <TimelineFooter state={footerState} active={active} inputRef={inputRef} draft={draft} setDraft={setDraft}
        sending={sending} send={send} sendErr={sendErr} onRestore={onRestore} actionOutcome={actionOutcome}
        onComposerPress={prepareComposerPress} />
    </div>
  )
}
