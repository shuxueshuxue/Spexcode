import { useEffect, useRef, useState } from 'react'
import { SpecBody } from './NodeView.jsx'
import { useMentionAutocomplete } from './mentions.jsx'
import { useT } from './i18n/index.jsx'

// The ONE thread UI ([[issues-view]]): the reply list + the reply composer, shared by every home an
// Issue thread renders in — the issue detail (BOTH stores: a forge issue's GitHub comments are the same
// replies[], [[issues]]) and the eval detail ([[event-detail]]). The composer is delivery-agnostic: the home
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

// E2 — the STEP-NAME is the anchor's canonical form; the m:ss is DERIVED from the CURRENT clip at render
// time, never trusted frozen. Resolve a parsed anchor against the viewed reading's step timeline (`events`,
// the {tMs, step} sidecar): if its step is in THIS reading's timeline, the moment is that step's live tMs, so
// the anchor seeks to the right frame even after a re-measure moved the step (the label's m:ss re-derives to
// match). If the step is gone from a PRESENT timeline, the frozen m:ss would seek to the wrong moment, so the
// anchor degrades to readable-not-seekable (shown, never silently wrong). With no timeline (or a step-less
// `▶m:ss`), the frozen m:ss is all there is — seek to it as before. Returns { tMs, step, label, seekable,
// degraded } or null.
export function resolveAnchor(anchor, events) {
  if (!anchor) return null
  if (anchor.step && events?.length) {
    const hit = events.find((e) => e.step === anchor.step)
    if (hit) return { tMs: hit.tMs, step: anchor.step, label: anchorLine(hit.tMs, anchor.step), seekable: true, degraded: false }
    // the step named at author time is absent from this reading's timeline — readable, not seekable.
    return { tMs: anchor.tMs, step: anchor.step, label: anchor.label, seekable: false, degraded: true }
  }
  return { tMs: anchor.tMs, step: anchor.step, label: anchor.label, seekable: true, degraded: false }
}

// Over a clip ([[event-detail]]) the reply list is the review track: `selIdx`/`activeIdx` mark the explicitly
// selected and the playhead-inside comments (in sync with the scrubber's markers), and clicking an anchor
// chip both seeks AND selects (`onSelect(i, tMs)`) so keyboard jumps and marker clicks share one selection.
// Off a clip these are all absent and a reply renders exactly as before. `events` is the viewed reading's
// step timeline: each anchor is resolved by STEP-NAME against it (E2, resolveAnchor) so its moment tracks a
// re-measure, degrading to a readable-not-seekable chip when the step is gone. A reply that is a REMARK
// ([[remark-substrate]] — it carries `rid`) shows its `resolved` bit: a resolved remark renders settled
// (dimmed, ✓), an open one prominent — the loss the eval scoreboard is still carrying, made visible in place.
export function Replies({ replies, onSeek, selIdx = null, activeIdx = null, onSelect = null, events = null }) {
  const t = useT()
  return replies.map((r, i) => {
    const parsed = parseAnchor(r.body)
    const a = resolveAnchor(parsed, events)              // E2: canonical step → the current clip's live tMs
    const src = parsed ? parsed.rest : r.body
    const img = FRAME_MD.exec(src)                       // a circled-frame image renders here, not as raw md
    const prose = (img ? src.replace(img[0], '') : src).trim()
    const isRemark = r.rid !== undefined
    const remarkCls = isRemark ? (r.resolved ? ' remark resolved' : ' remark open') : ''
    const cls = `fv-reply${selIdx === i ? ' sel' : ''}${activeIdx === i ? ' active' : ''}${remarkCls}`
    const seek = a && a.seekable && onSeek ? () => (onSelect ? onSelect(i, a.tMs) : onSeek(a.tMs)) : null
    return (
      <div className={cls} key={i}>
        <div className="fv-reply-meta">
          <span className="fv-reply-by">{r.by}</span>
          {r.at && <span className="fv-reply-at">{r.at}</span>}
          {a && (seek
            ? <button type="button" className="fv-anchor" onClick={seek} title="seek the clip to this moment">{a.label}</button>
            : <span className={`fv-anchor static${a.degraded ? ' degraded' : ''}`} title={a.degraded ? t('thread.anchorDegraded') : undefined}>{a.label}{a.degraded ? ' ⚠' : ''}</span>)}
          {isRemark && (r.resolved
            ? <span className="fv-remark-state resolved" title={r.resolvedBy ? t('thread.resolvedBy', { by: r.resolvedBy }) : t('thread.resolved')}>✓ {t('thread.resolved')}</span>
            : <span className="fv-remark-state open" title={t('thread.openRemark')}>● {t('thread.openRemark')}</span>)}
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

  // a circle prefills this composer: replace the draft with its anchored body + frame link, then focus for
  // edit. A NULL draft CLEARS — the host nulls it when the working state resets (a selection change, an A/B
  // flip), and preserving the old text past that reset is exactly the cross-eval draft leak; a freshly
  // mounted composer may also briefly see the host's stale draft before the host's own reset effect runs,
  // so the clear (not an early return) is what makes the reset stick.
  useEffect(() => {
    if (!draft) { setBody(''); return }
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
