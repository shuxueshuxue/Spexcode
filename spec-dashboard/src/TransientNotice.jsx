import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon, IconButton } from './icons.jsx'
import { useT } from './i18n/index.jsx'
import { resolveNoticeDuration } from './noticeTiming.js'

const NoticeContext = createContext(null)
let nextNoticeId = 0

function noticeOptions(message, options = {}) {
  const kind = ['success', 'error', 'info'].includes(options.kind) ? options.kind : 'info'
  const duration = resolveNoticeDuration(message, options.duration)
  return { kind, duration }
}

function TransientNoticeViewport({ notices, dismiss, setInteraction }) {
  const t = useT()
  const viewport = useRef(null)

  useLayoutEffect(() => {
    const element = viewport.current
    if (element) element.scrollTop = element.scrollHeight
  }, [notices.length])

  if (!notices.length) return null
  const iconFor = { success: 'circle-check', error: 'circle-x', info: 'info' }
  return (
    <div className="tn-viewport" ref={viewport}>
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={`tn-notice ${notice.kind}`}
          data-paused={notice.paused ? 'true' : undefined}
          style={{ '--tn-duration': `${notice.duration}ms` }}
          role={notice.kind === 'error' ? 'alert' : 'status'}
          onPointerEnter={() => setInteraction(notice.id, 'pointer', true)}
          onPointerLeave={() => setInteraction(notice.id, 'pointer', false)}
          onFocus={() => setInteraction(notice.id, 'focus', true)}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setInteraction(notice.id, 'focus', false) }}
        >
          <Icon name={iconFor[notice.kind]} size={16} className="tn-icon" />
          <span className="tn-message">{notice.message}</span>
          <IconButton icon="x" size={14} className="tn-dismiss" label={t('common.close')} onClick={() => dismiss(notice.id)} />
          {notice.duration > 0 && <span className="tn-progress" aria-hidden="true" />}
        </div>
      ))}
    </div>
  )
}

export function TransientNoticeProvider({ children }) {
  const [notices, setNotices] = useState([])
  const timers = useRef(new Map())
  const interactions = useRef(new Map())

  const clearTimer = useCallback((id) => {
    const timer = timers.current.get(id)
    if (!timer) return
    if (timer.handle) window.clearTimeout(timer.handle)
    timers.current.delete(id)
  }, [])

  const dismiss = useCallback((id) => {
    clearTimer(id)
    interactions.current.delete(id)
    setNotices((current) => current.filter((notice) => notice.id !== id))
  }, [clearTimer])

  const schedule = useCallback((id, remaining) => {
    if (remaining <= 0) { dismiss(id); return }
    clearTimer(id)
    const deadline = Date.now() + remaining
    const handle = window.setTimeout(() => dismiss(id), remaining)
    timers.current.set(id, { deadline, remaining, handle })
  }, [clearTimer, dismiss])

  const notify = useCallback((message, options) => {
    const text = String(message ?? '').trim()
    if (!text) return null
    const { kind, duration } = noticeOptions(text, options)
    const id = `notice-${++nextNoticeId}`
    interactions.current.set(id, { pointer: false, focus: false })
    setNotices((current) => [...current, { id, kind, message: text, duration, paused: false }])
    if (duration) schedule(id, duration)
    return id
  }, [schedule])

  const setInteraction = useCallback((id, source, active) => {
    const interaction = interactions.current.get(id)
    if (!interaction || interaction[source] === active) return
    interaction[source] = active
    const paused = interaction.pointer || interaction.focus
    const timer = timers.current.get(id)
    if (!timer) return
    if (paused && timer.handle) {
      window.clearTimeout(timer.handle)
      timer.handle = null
      timer.remaining = Math.max(0, timer.deadline - Date.now())
    } else if (!paused && !timer.handle) {
      schedule(id, timer.remaining)
    }
    setNotices((current) => current.map((notice) => notice.id === id ? { ...notice, paused } : notice))
  }, [schedule])

  useEffect(() => () => {
    for (const { handle } of timers.current.values()) if (handle) window.clearTimeout(handle)
    timers.current.clear()
    interactions.current.clear()
  }, [])

  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss])
  return (
    <NoticeContext.Provider value={value}>
      {children}
      <TransientNoticeViewport notices={notices} dismiss={dismiss} setInteraction={setInteraction} />
    </NoticeContext.Provider>
  )
}

export function useTransientNotice() {
  const context = useContext(NoticeContext)
  if (!context) throw new Error('useTransientNotice must be rendered inside TransientNoticeProvider')
  return context
}
