import { useEffect, useRef, useState } from 'react'
import { SpecBody } from './NodeView.jsx'
import { useMentionAutocomplete } from './mentions.jsx'
import { useT } from './i18n/index.jsx'

// The ONE thread UI ([[issues-view]]): the reply list + the reply composer, shared by every home an
// Issue thread renders in — the issue detail (BOTH stores: a forge issue's GitHub comments are the same
// replies[], [[issues]]) and the eval detail ([[annotator]]). The composer is delivery-agnostic: the home
// passes `onSend(text, evidence)` (reply to an existing thread — the server routes it by the issue's store,
// forum commit or real forge comment — or lazily create one), so the thread's binding stays the caller's
// concern while the writing surface stays one component — an @-mention dispatches wherever it is typed,
// because every send lands on the same store-routed write path.
//
// A reply is TIME-ANCHORED by a prose convention (same philosophy as `Spec:`/`[[node]]`): a body whose
// first line reads `▶m:ss · <step>` IS anchored to that video moment. The renderer linkifies it (click =
// seek the clip); the composer over a clip grows a ⏱ affordance that stamps the current frame, and a
// circled frame rides the body as a `![frame](/api/yatsu/blob/<hash>)` image link — the SAME hash the send
// derives as the thread's typed `evidence[]`, so the body is the one raw-readable source. The reply stays
// plain `{ by, at, body }`; no schema grows.

const ANCHOR_RE = /^▶\s*(\d+):([0-5]?\d)(?:\s*·\s*([^\n]*))?/
const BLOB_URL = /\/api\/yatsu\/blob\/([0-9a-f]{64})/g
const FRAME_MD = /!\[[^\]]*\]\((\/api\/yatsu\/blob\/[0-9a-f]{64})\)/   // an inline frame image link
export const mmss = (tMs) => { const s = Math.floor(tMs / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
// the first line of a body, parsed as an anchor: { tMs, step, label, rest } or null. `rest` is the body
// with the anchor line stripped, so the moment renders as a chip and the prose renders below it.
export function parseAnchor(body) {
  const src = body || ''
  const firstLine = src.split('\n', 1)[0]
  const m = ANCHOR_RE.exec(firstLine)
  if (!m) return null
  const tMs = (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 1000
  return { tMs, step: m[3]?.trim() || null, label: firstLine.trim(), rest: src.slice(firstLine.length).replace(/^\n/, '') }
}
// build the anchor line for a moment (+ optional step) — the shape parseAnchor recognises.
export const anchorLine = (tMs, step) => `▶${mmss(tMs)}${step ? ` · ${step}` : ''}`
// the blob hashes a body references (its frame links) — the send derives the thread's `evidence[]` from here.
export const bodyEvidence = (body) => [...(body || '').matchAll(BLOB_URL)].map((m) => m[1])

export function Replies({ replies, onSeek }) {
  return replies.map((r, i) => {
    const a = parseAnchor(r.body)
    const src = a ? a.rest : r.body
    const img = FRAME_MD.exec(src)                       // a circled-frame image renders here, not as raw md
    const prose = (img ? src.replace(img[0], '') : src).trim()
    return (
      <div className="fv-reply" key={i}>
        <div className="fv-reply-meta">
          <span className="fv-reply-by">{r.by}</span>
          {r.at && <span className="fv-reply-at">{r.at}</span>}
          {a && (onSeek
            ? <button type="button" className="fv-anchor" onClick={() => onSeek(a.tMs)} title="seek the clip to this moment">{a.label}</button>
            : <span className="fv-anchor static">{a.label}</span>)}
        </div>
        {prose && <div className="fvd-body"><SpecBody body={prose} /></div>}
        {img && <img className="fv-frame-img" src={img[1]} alt="circled frame" />}
      </div>
    )
  })
}

// a small textarea + Send — posts through the caller's `onSend(text, evidence)` as 'human'. An @-mention in
// the text summons a worker; the returned outcomes string surfaces via onDone. The textarea carries the SAME
// `[[node]]`/`@session` autocomplete as the console ([[mentions]], one shared menu, never a fork); the
// composer is docked at the detail's bottom, so its menu opens UPWARD. The thread's own node leads the
// `[[` list. Over a clip the home passes `anchorNow()` → a ⏱ button stamps the current frame's `▶m:ss ·
// step` at the body's head; a circle pushes a `draft` (prefilled anchored body + a frame image link), so a
// mark is thereafter an ordinary — replyable, @-able — reply, its frame indexed as the thread's evidence[].
export function ReplyComposer({ onSend, specs = [], sessions = [], focusId = null, onDone, anchorNow = null, draft = null }) {
  const t = useT()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')       // a failed send (a forge can be unreachable) surfaces, never swallows
  const taRef = useRef(null)
  const ac = useMentionAutocomplete({ inputRef: taRef, value: body, setValue: setBody, specs, sessions, focusId, up: true })
  const frames = bodyEvidence(body)         // the frame links currently in the draft (preview + the send's evidence[])

  // a circle prefills this composer: replace the draft with its anchored body + frame link, then focus for edit.
  useEffect(() => {
    if (!draft) return
    setBody(draft.body || '')
    taRef.current?.focus()
  }, [draft?.seq])

  // ⏱ — stamp (or re-stamp) the current frame as this comment's anchor line, keeping the prose below it.
  const stampAnchor = () => {
    const a = anchorNow?.()
    if (!a) return
    const line = anchorLine(a.tMs, a.step)
    setBody((b) => { const ex = parseAnchor(b); return ex ? `${line}\n${ex.rest}` : (b ? `${line}\n${b}` : `${line}\n`) })
    taRef.current?.focus()
  }

  const send = async () => {
    const text = body.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const res = await onSend(text, bodyEvidence(text))
      if (res?.ok) { setBody(''); setErr(''); await onDone?.(res.outcomes || '') }
      else setErr(res?.error || 'reply failed')
    } finally { setBusy(false) }
  }
  return (
    <div className="fv-compose">
      {frames.length > 0 && (
        <div className="fv-frames">
          {frames.map((h) => <img className="fv-frame" src={`/api/yatsu/blob/${h}`} alt="frame" key={h} />)}
        </div>
      )}
      <div className="fv-tawrap">
        <textarea ref={taRef} className="fv-textarea" rows={2} value={body} placeholder={t('session.issuesReplyPlaceholder')}
          disabled={busy} onChange={(e) => { setBody(e.target.value); ac.sync(e.target) }}
          onSelect={(e) => ac.sync(e.target)} onBlur={ac.close}
          onKeyDown={(e) => { if (ac.onKeyDown(e)) return; if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }} />
        {ac.menuEl}
      </div>
      <div className="fv-actions">
        {anchorNow && <button type="button" className="fv-anchor-btn" title={t('thread.anchorTitle')} onClick={stampAnchor}>⏱ {t('thread.anchorNow')}</button>}
        <span className="fv-hint">{err || t('session.issuesMentionHint')}</span>
        <button type="button" className="fv-send" disabled={busy || !body.trim()} onClick={send}>
          {busy ? t('session.issuesSending') : t('session.issuesSend')}
        </button>
      </div>
    </div>
  )
}
