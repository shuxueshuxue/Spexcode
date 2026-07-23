import { useEffect, useMemo, useRef, useState } from 'react'

import { loadSessionMessages, subscribeSessionMessages } from './data.js'
import { Icon } from './icons.jsx'
import { useT } from './i18n/index.jsx'
import { rowsFromMessages } from './messageStream.js'

export default function SessionMessages({ sessionId, active }) {
  const t = useT()
  const [messages, setMessages] = useState(null)
  const [streamState, setStreamState] = useState('loading')
  const scrollRef = useRef(null)
  const pinnedRef = useRef(true)
  const rows = useMemo(() => rowsFromMessages(messages), [messages])

  useEffect(() => {
    if (!active) return
    let closed = false
    let unsubscribe = () => {}
    setStreamState('loading')
    loadSessionMessages(sessionId).then((batch) => {
      if (closed) return
      setMessages(batch.messages)
      setStreamState('connecting')
      unsubscribe = subscribeSessionMessages(sessionId, batch.cursor, {
        onMessage: (message) => setMessages((current) => {
          const existing = current || []
          if (existing.length && message.cursor <= existing[existing.length - 1].cursor) return existing
          return [...existing, message]
        }),
        onStatus: (connected) => setStreamState((current) => connected ? 'live' : current === 'error' ? current : 'disconnected'),
        onError: () => setStreamState('error'),
      })
    }).catch(() => { if (!closed) { setMessages([]); setStreamState('error') } })
    return () => { closed = true; unsubscribe() }
  }, [active, sessionId])

  const onScroll = () => {
    const element = scrollRef.current
    if (element) pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48
  }
  useEffect(() => {
    const element = scrollRef.current
    if (element && pinnedRef.current) element.scrollTop = element.scrollHeight
  }, [messages])

  return (
    <div className="ms-console">
      <div className="ms-scroll" ref={scrollRef} onScroll={onScroll} aria-live="polite">
        {messages === null
          ? <div className="ms-empty">{t('session.messagesLoading')}</div>
          : rows.length === 0 ? <div className="ms-empty">{t('session.messagesEmpty')}</div> : rows.map((row) => (
            row.kind === 'tool' ? (
              <div className="ms-tool" key={row.key} title={row.summary || row.name}>
                <Icon name="terminal" size={13} />
                <span className="ms-tool-name">{row.name}</span>
                {row.summary && <code className="ms-tool-summary">{row.summary}</code>}
              </div>
            ) : (
              <div className={`ms-turn ${row.kind}`} key={row.key}>
                <span className="ms-role">{t(row.kind === 'user' ? 'session.messagesYou' : 'session.messagesAssistant')}</span>
                <div className="ms-bubble">{row.text}</div>
              </div>
            )
          ))}
      </div>
      {(streamState === 'disconnected' || streamState === 'error') && (
        <div className={`ms-state ${streamState}`} role="status">
          {t(streamState === 'error' ? 'session.messagesUnavailable' : 'session.messagesDisconnected')}
        </div>
      )}
    </div>
  )
}
