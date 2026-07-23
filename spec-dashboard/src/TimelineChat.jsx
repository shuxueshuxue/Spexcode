import { useCallback, useEffect, useRef, useState } from 'react'
import { sessionHeadline, STATUS_COLOR, STATUS_GLYPH } from './session.js'
import { loadSessionTimeline, loadSessionDetail, sendSessionText } from './data.js'
import SessionMessages from './SessionMessages.jsx'
import { isMessageStreamSession } from './messageStream.js'
import { Icon } from './icons.jsx'
import { useT } from './i18n/index.jsx'

// hour:minute for an event row; a short date for the day separators the timeline inserts when the
// calendar day flips between neighbouring events.
const timeOf = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const dayOf = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
const dayKey = (ts) => new Date(ts).toDateString()

// a poll answer is usually the SAME history — keep the old array identity then, so nothing downstream
// (the pin effect above all) re-fires on a no-change tick. Append-only log: length + last entry decide.
const sameEvents = (a, b) => a != null && a.length === b.length
  && (a.length === 0 || JSON.stringify(a[a.length - 1]) === JSON.stringify(b[b.length - 1]))

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
  const pinnedRef = useRef(true)   // is the reader at the newest entry? Only then does a refresh follow it.

  const load = useCallback(() => loadSessionTimeline(s.id).then((d) => {
    if (d) setEvents((prev) => (sameEvents(prev, d.events) ? prev : d.events))
  }), [s.id])
  useEffect(() => { setEvents(null); setDetail(null); pinnedRef.current = true; load(); loadSessionDetail(s.id).then((d) => { if (d) setDetail(d) }) }, [s.id, load])
  useEffect(() => { setFullProcess(false) }, [s.id, hasFullProcess])
  useEffect(() => {
    const iv = setInterval(load, 8000)
    return () => clearInterval(iv)
  }, [load])
  useEffect(() => { load() }, [s.status, s.note, load])
  // chat-style pinning that respects the thumb: follow new entries only while the reader is already at
  // the bottom — a reader parked up in history is never yanked down by a poll.
  const onScroll = () => { const el = scrollRef.current; if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48 }
  useEffect(() => { const el = scrollRef.current; if (el && pinnedRef.current) el.scrollTop = el.scrollHeight }, [events])

  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true); setSendErr(null)
    // replyVia:'note' is this surface's FIXED property, not a per-message choice: a terminal-free sender
    // can only ever read declaration notes, so every dispatch asks for its reply there — silently.
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
          {e.note && <div className="m-ev-note">{e.note}</div>}
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
      <div className="m-timeline" ref={scrollRef} onScroll={onScroll}>
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
            className="m-input"
            rows={1}
            placeholder={t('mobile.inputPlaceholder')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="m-send" disabled={!draft.trim() || sending} onClick={send}>{t('mobile.send')}</button>
        </div>
      </div>
    </div>
  )
}
