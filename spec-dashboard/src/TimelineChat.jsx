import { useCallback, useEffect, useRef, useState } from 'react'
import { sessionHeadline, STATUS_COLOR, STATUS_GLYPH } from './session.js'
import { loadSessionTimeline, loadSessionDetail, sendSessionText } from './data.js'
import SessionMessages from './SessionMessages.jsx'
import { isMessageStreamSession } from './messageStream.js'
import { Icon } from './icons.jsx'
import { useT } from './i18n/index.jsx'
import { inertChromePress } from './focus.js'

// hour:minute for an event row; a short date for the day separators the timeline inserts when the
// calendar day flips between neighbouring events.
const timeOf = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const dayOf = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
const dayKey = (ts) => new Date(ts).toDateString()

// a poll answer is usually the SAME history — keep the old array identity then, so nothing downstream
// (the pin effect above all) re-fires on a no-change tick. Append-only log: length + last entry decide.
const sameEvents = (a, b) => a != null && a.length === b.length
  && (a.length === 0 || JSON.stringify(a[a.length - 1]) === JSON.stringify(b[b.length - 1]))

const SELECTION_CONTROLS = 'button, summary, a, input, textarea, select, option, label, [role], [contenteditable]:not([contenteditable="false"])'
const EDITING_KEYS = new Set([
  'Backspace', 'Delete', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Home', 'End', 'PageUp', 'PageDown',
])

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

const copyTimelineText = (text) => {
  const copy = navigator.clipboard?.writeText(text)
  copy?.catch(() => {})
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

// @@@ the terminal-free conversation body ([[session-timeline]]) — the phone's session detail
// ([[mobile-ui]]). Without a pane to read, the persisted timeline IS the interaction record: every
// authored status transition (with the full declaration note — the agent's reply) and every delivered
// prompt, timestamped, oldest first, with the composer docked below. Freshness: an 8s poll while shown,
// plus an immediate refetch whenever the board push moves this session's status/note (the board stream is
// already live in the host app), plus one after every send.
export default function TimelineChat({ s, sessions = [], active = true }) {
  const t = useT()
  const hasFullProcess = isMessageStreamSession(s)
  const [events, setEvents] = useState(null)
  const [detail, setDetail] = useState(null)   // the record detail — carries the full originating prompt
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendErr, setSendErr] = useState(null)
  const [fullProcess, setFullProcess] = useState(false)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const selectionDragRef = useRef(null)
  const timelineRangeRef = useRef(null)
  const pinnedRef = useRef(true)   // is the reader at the newest entry? Only then does a refresh follow it.

  const load = useCallback(() => loadSessionTimeline(s.id).then((d) => {
    if (d) setEvents((prev) => (sameEvents(prev, d.events) ? prev : d.events))
  }), [s.id])
  useEffect(() => {
    if (!active) return undefined
    setEvents(null); setDetail(null); pinnedRef.current = true
    load(); loadSessionDetail(s.id).then((d) => { if (d) setDetail(d) })
    return undefined
  }, [s.id, load, active])
  useEffect(() => { setFullProcess(false) }, [s.id, hasFullProcess])
  useEffect(() => {
    if (!active) return undefined
    const iv = setInterval(load, 8000)
    return () => clearInterval(iv)
  }, [load, active])
  useEffect(() => { if (active) load() }, [s.status, s.note, load, active])
  // chat-style pinning that respects the thumb: follow new entries only while the reader is already at
  // the bottom — a reader parked up in history is never yanked down by a poll.
  const onScroll = () => { const el = scrollRef.current; if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48 }
  useEffect(() => { const el = scrollRef.current; if (el && pinnedRef.current) el.scrollTop = el.scrollHeight }, [events])

  const clearSelection = () => {
    timelineRangeRef.current = null
    clearTimelineHighlight()
  }

  // @@@ The composer is a continuous sink. Conversation selection is painted by CSS Custom Highlight,
  // so no document Selection ever competes with the textarea's real caret.
  const beginTimelineSelection = (e) => {
    const timeline = scrollRef.current
    const target = e.target
    if (e.button !== 0 || !timeline || !(target instanceof Element)) return
    clearSelection()
    const control = target.closest(SELECTION_CONTROLS)
    if (control && timeline.contains(control)) return
    if (target === timeline) {
      const rect = timeline.getBoundingClientRect()
      if (e.clientX - rect.left - timeline.clientLeft >= timeline.clientWidth
        || e.clientY - rect.top - timeline.clientTop >= timeline.clientHeight) return
    }
    const anchor = rangeAtPoint(timeline, e.clientX, e.clientY)
    if (!anchor) return
    e.preventDefault()
    selectionDragRef.current = { anchor: anchor.cloneRange(), x: e.clientX, y: e.clientY }
  }

  const selectTimelineWord = (e) => {
    const target = e.target
    const timeline = scrollRef.current
    if (e.button !== 0 || !timeline || !(target instanceof Element)) return
    const control = target.closest(SELECTION_CONTROLS)
    if (control && timeline.contains(control)) return
    const range = wordRangeAtPoint(timeline, e.clientX, e.clientY)
    if (!range) return
    e.preventDefault()
    selectionDragRef.current = null
    timelineRangeRef.current = range
    setTimelineHighlight(range)
  }

  useEffect(() => {
    if (!active) return undefined
    const onMouseMove = (e) => {
      const drag = selectionDragRef.current
      const timeline = scrollRef.current
      if (!drag || !timeline) return
      e.preventDefault()
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return
      const focus = rangeAtPoint(timeline, e.clientX, e.clientY)
      if (!focus || !drag.anchor.startContainer.isConnected) return
      const range = document.createRange()
      const forward = drag.anchor.compareBoundaryPoints(Range.START_TO_START, focus) <= 0
      const start = forward ? drag.anchor : focus
      const end = forward ? focus : drag.anchor
      range.setStart(start.startContainer, start.startOffset)
      range.setEnd(end.startContainer, end.startOffset)
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
        const copy = navigator.clipboard?.writeText(range.toString())
        copy?.catch(() => {})
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
  }, [active])

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

  // day-separated render list, oldest first (the wire order)
  const rows = []
  let lastDay = null
  for (const [i, e] of (events || []).entries()) {
    if (dayKey(e.ts) !== lastDay) { lastDay = dayKey(e.ts); rows.push(<div className="m-day" key={`d${i}`}>{dayOf(e.ts)}</div>) }
    if (e.kind === 'status') {
      const d = e.display || e.status
      rows.push(
        <div className="m-ev" key={i}>
          <div className="m-ev-head">
            <span className="m-ev-glyph" style={{ color: STATUS_COLOR[d] }}>{STATUS_GLYPH[d] || '·'}</span>
            <span className="m-ev-word" style={{ color: STATUS_COLOR[d] }}>{t(`status.${d}`)}</span>
            <span className="m-ev-time">{timeOf(e.ts)}</span>
          </div>
          {e.note && (
            <div className="m-ev-note">
              {e.note}
              {!hasTimelineHighlight() && (
                <button type="button" className="m-copy-note" onClick={() => copyTimelineText(e.note)}>
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
          <div className="m-ev-text">{e.text}</div>
        </div>,
      )
    }
  }

  const offline = s.liveness === 'offline' || s.status === 'offline'
  if (fullProcess && hasFullProcess) {
    return (
      <div className="tl-process">
        <header className="tl-process-head">
          <button type="button" className="tl-process-back" onClick={() => setFullProcess(false)}>
            <Icon name="arrow-left" size={14} />
            <span>{t('session.backToConversation')}</span>
          </button>
          <span className="tl-process-title">{t('session.fullProcess')}</span>
        </header>
        <SessionMessages sessionId={s.id} active={active} />
      </div>
    )
  }
  return (
    <div className="tl-chat">
      {hasFullProcess && (
        <div className="tl-chat-tools">
          <button type="button" className="tl-process-door" onClick={() => setFullProcess(true)}>
            <Icon name="list-checks" size={14} />
            <span>{t('session.fullProcess')}</span>
            <Icon name="chevron-right" size={13} />
          </button>
        </div>
      )}
      <div className="m-timeline" ref={scrollRef} onScroll={onScroll}
        onMouseDownCapture={inertChromePress} onMouseDown={beginTimelineSelection}
        onDoubleClick={selectTimelineWord}>
        {detail?.prompt && (
          <details className="m-ev m-ev-prompt">
            <summary>{t('mobile.asked')}{s.created ? ` · ${dayOf(s.created)} ${timeOf(s.created)}` : ''}</summary>
            <div className="m-ev-text">{detail.prompt}</div>
          </details>
        )}
        {events === null
          ? <div className="m-empty">{t('common.loading')}</div>
          : rows.length === 0 ? <div className="m-empty">{t('mobile.noEvents')}</div> : rows}
      </div>
      {offline && <div className="m-offline">{t('mobile.offlineHint')}</div>}
      {sendErr && <div className="m-senderr">{sendErr}</div>}
      <div className="m-composer">
        <div className="m-composer-line">
          <textarea
            ref={inputRef}
            className="m-input"
            data-focus-sink={active ? '' : undefined}
            rows={1}
            placeholder={t('mobile.inputPlaceholder')}
            value={draft}
            onMouseDownCapture={prepareComposerPress}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="m-send" disabled={!draft.trim() || sending} onClick={send}>{t('mobile.send')}</button>
        </div>
      </div>
    </div>
  )
}
