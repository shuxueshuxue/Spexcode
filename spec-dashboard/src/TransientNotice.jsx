import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, IconButton } from './icons.jsx'
import { useT } from './i18n/index.jsx'

const DEFAULT_DURATION = 5000
const NoticeContext = createContext(null)
let nextNoticeId = 0

function noticeOptions(options = {}) {
  const kind = ['success', 'error', 'info'].includes(options.kind) ? options.kind : 'info'
  const duration = options.duration === undefined ? DEFAULT_DURATION : options.duration
  if (!Number.isFinite(duration) || duration < 0) throw new Error('notice duration must be a non-negative finite number')
  return { kind, duration }
}

function TransientNoticeViewport({ notices, dismiss, pause, resume }) {
  const t = useT()
  if (!notices.length) return null
  const iconFor = { success: 'circle-check', error: 'circle-x', info: 'info' }
  return (
    <div className="tn-viewport">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={`tn-notice ${notice.kind}`}
          data-paused={notice.paused ? 'true' : undefined}
          style={{ '--tn-duration': `${notice.duration}ms` }}
          role={notice.kind === 'error' ? 'alert' : 'status'}
          onPointerEnter={() => pause(notice.id)}
          onPointerLeave={() => resume(notice.id)}
          onFocus={() => pause(notice.id)}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) resume(notice.id) }}
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

  const clearTimer = useCallback((id) => {
    const timer = timers.current.get(id)
    if (!timer) return
    if (timer.handle) window.clearTimeout(timer.handle)
    timers.current.delete(id)
  }, [])

  const dismiss = useCallback((id) => {
    clearTimer(id)
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
    const { kind, duration } = noticeOptions(options)
    const id = `notice-${++nextNoticeId}`
    setNotices((current) => [...current, { id, kind, message: text, duration, paused: false }])
    if (duration) schedule(id, duration)
    return id
  }, [schedule])

  const pause = useCallback((id) => {
    const timer = timers.current.get(id)
    if (!timer) return
    window.clearTimeout(timer.handle)
    timer.handle = null
    timer.remaining = Math.max(0, timer.deadline - Date.now())
    setNotices((current) => current.map((notice) => notice.id === id ? { ...notice, paused: true } : notice))
  }, [])

  const resume = useCallback((id) => {
    const timer = timers.current.get(id)
    if (!timer || timer.handle) return
    schedule(id, timer.remaining)
    setNotices((current) => current.map((notice) => notice.id === id ? { ...notice, paused: false } : notice))
  }, [schedule])

  useEffect(() => () => {
    for (const { handle } of timers.current.values()) if (handle) window.clearTimeout(handle)
    timers.current.clear()
  }, [])

  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss])
  return (
    <NoticeContext.Provider value={value}>
      {children}
      <TransientNoticeViewport notices={notices} dismiss={dismiss} pause={pause} resume={resume} />
    </NoticeContext.Provider>
  )
}

export function useTransientNotice() {
  const context = useContext(NoticeContext)
  if (!context) throw new Error('useTransientNotice must be rendered inside TransientNoticeProvider')
  return context
}
