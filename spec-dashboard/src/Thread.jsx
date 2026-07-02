import { useRef, useState } from 'react'
import { SpecBody } from './NodeView.jsx'
import { useMentionAutocomplete } from './mentions.jsx'
import { useT } from './i18n/index.jsx'

// The ONE local-thread UI ([[issues-view]]): the reply list + the reply composer, shared by every home a
// local Issue thread renders in — the issue detail and the eval detail ([[annotator]]). The composer is
// delivery-agnostic: the home passes `onSend(text)` (reply to an existing thread, or lazily create one),
// so the thread's binding stays the caller's concern while the writing surface stays one component — an
// @-mention dispatches wherever it is typed, because every send lands on the same forum write path.

export function Replies({ replies }) {
  return replies.map((r, i) => (
    <div className="fv-reply" key={i}>
      <div className="fv-reply-meta">
        <span className="fv-reply-by">{r.by}</span>
        {r.at && <span className="fv-reply-at">{r.at}</span>}
      </div>
      <div className="fvd-body"><SpecBody body={r.body} /></div>
    </div>
  ))
}

// a small textarea + Send — posts through the caller's `onSend` as 'human'. An @-mention in the text
// summons a worker; the returned outcomes string surfaces via onDone. The textarea carries the SAME
// `[[node]]`/`@session` autocomplete as the console ([[mentions]], one shared menu, never a fork); the
// composer is docked at the detail's bottom, so its menu opens UPWARD. The thread's own node leads the
// `[[` list — the convenient default topic here.
export function ReplyComposer({ onSend, specs = [], sessions = [], focusId = null, onDone }) {
  const t = useT()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const taRef = useRef(null)
  const ac = useMentionAutocomplete({ inputRef: taRef, value: body, setValue: setBody, specs, sessions, focusId, up: true })
  const send = async () => {
    const text = body.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const res = await onSend(text)
      if (res?.ok) { setBody(''); await onDone?.(res.outcomes || '') }
    } finally { setBusy(false) }
  }
  return (
    <div className="fv-compose">
      <div className="fv-tawrap">
        <textarea ref={taRef} className="fv-textarea" rows={2} value={body} placeholder={t('session.issuesReplyPlaceholder')}
          disabled={busy} onChange={(e) => { setBody(e.target.value); ac.sync(e.target) }}
          onSelect={(e) => ac.sync(e.target)} onBlur={ac.close}
          onKeyDown={(e) => { if (ac.onKeyDown(e)) return; if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }} />
        {ac.menuEl}
      </div>
      <div className="fv-actions">
        <span className="fv-hint">{t('session.issuesMentionHint')}</span>
        <button type="button" className="fv-send" disabled={busy || !body.trim()} onClick={send}>
          {busy ? t('session.issuesSending') : t('session.issuesSend')}
        </button>
      </div>
    </div>
  )
}
