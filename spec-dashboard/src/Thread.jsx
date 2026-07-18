import { useEffect, useRef, useState } from 'react'
import { SpecBody } from './NodeView.jsx'
import { BlobMedia } from './Evidence.jsx'
import { useMentionAutocomplete, matchSlash, SlashMenu } from './mentions.jsx'
import { useLaunchers } from './launch.js'
import { fitTextarea } from './textarea.js'
import { postRemarkAction } from './data.js'
import { STATUS_COLOR, liveSession } from './session.js'
import { useT } from './i18n/index.jsx'
import { Icon, IconButton } from './icons.jsx'

// The ONE thread UI ([[issues-view]]): the reply list + the reply composer, shared by every home an
// Issue thread renders in — the issue detail (BOTH stores: a forge issue's GitHub comments are the same
// replies[], [[issues]]) and the eval detail ([[event-detail]]). The composer is delivery-agnostic: the home
// passes `onSend(text, evidence)` (reply to an existing thread — the server routes it by the issue's store,
// local-store commit or real forge comment — or lazily create one), so the thread's binding stays the caller's
// concern while the writing surface stays one component — an @-mention dispatches wherever it is typed,
// because every send lands on the same store-routed write path.
//
// A reply is TIME-ANCHORED by a prose convention (same philosophy as `Spec:`/`[[node]]`): a body whose
// first line reads `▶m:ss · <step>` IS anchored to that video moment. The renderer linkifies it (click =
// seek the clip); the composer over a clip grows a ⏱ affordance that stamps the current frame, and a
// circled frame — or any attached blob, a clip included — rides the body as a
// `![…](/api/evidence/<hash>)` link — the SAME hash the send derives as the thread's typed
// `evidence[]`, so the body is the one raw-readable source. Each linked blob renders through the ONE
// shared evidence renderer ([[event-detail]]'s Evidence.jsx, kind sniffed from the served Content-Type):
// a video PLAYS in the thread, an image shows, a pruned blob is the honest sentinel. The reply stays
// plain `{ by, at, body }`; no schema grows.

const ANCHOR_RE = /^▶\s*(\d+):([0-5]?\d)(?:\s*·\s*([^\n]*))?/
// READ regexes accept the archived `/api/yatsu/blob/…` shape beside the live `/api/evidence/…` one:
// committed thread bodies are immutable archives, and an archive keeps its archive name — extraction
// yields the bare hash, so rendering/fetching always goes through the live route. Writes emit only the new shape.
const HEAD_FRAME_RE = /^!\[frame\]\(\/api\/(?:evidence|yatsu\/blob)\/[0-9a-f]{64}\)\n?/   // the anchor's OWN frame, riding right under its line
const BLOB_URL = /\/api\/(?:evidence|yatsu\/blob)\/([0-9a-f]{64})/g
const BLOB_MD = /!\[[^\]]*\]\(\/api\/(?:evidence|yatsu\/blob)\/([0-9a-f]{64})\)/g   // an inline evidence link (frame, clip, …)
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
// the {at, step} sidecar): if its step is in THIS reading's timeline, the moment is that step's live position, so
// the anchor seeks to the right frame even after a re-measure moved the step (the label's m:ss re-derives to
// match). If the step is gone from a PRESENT timeline, the frozen m:ss would seek to the wrong moment, so the
// anchor degrades to readable-not-seekable (shown, never silently wrong). With no timeline (or a step-less
// `▶m:ss`), the frozen m:ss is all there is — seek to it as before. Returns { tMs, step, label, seekable,
// degraded } or null.
export function resolveAnchor(anchor, events) {
  if (!anchor) return null
  if (anchor.step && events?.length) {
    const hit = events.find((e) => e.step === anchor.step)
    if (hit) return { tMs: hit.at, step: anchor.step, label: anchorLine(hit.at, anchor.step), seekable: true, degraded: false }
    // the step named at author time is absent from this reading's timeline — readable, not seekable.
    return { tMs: anchor.tMs, step: anchor.step, label: anchor.label, seekable: false, degraded: true }
  }
  return { tMs: anchor.tMs, step: anchor.step, label: anchor.label, seekable: true, degraded: false }
}

// The thread's ORIGINATOR liveness ([[mentions]] loop-in) — WHO filed this issue/eval, and whether their
// session is still ALIVE. This is a thin join of the originator id against the live board sessions the page
// already holds — session.js's liveSession, the SAME judgment the issues/evals live chips filter by
// ([[live-session-filter]]), so a chip-filtered list and these dots can never disagree. A live originator is
// a direct door to its session-board tab; offline remains a
// static identity chip. Reuses the board's four-hue STATUS_COLOR (the live status paints the dot), never a
// second palette. `kind` ('issue' | 'eval') only picks the label wording. A missing/unresolvable originator
// renders nothing — exactly the case where the loop-in chain runs dry silently (a forge github login, a
// legacy reading).
export function OriginatorLiveness({ originator, sessions = [], kind = 'issue', onOpenSession = null }) {
  const t = useT()
  if (!originator) return null
  const s = liveSession(sessions, originator)
  const alive = !!s
  const color = alive ? (STATUS_COLOR[s.status] || STATUS_COLOR.working) : STATUS_COLOR.offline
  const title = t(kind === 'eval' ? 'thread.originatorEval' : 'thread.originatorIssue', { by: originator })
  const body = (
    <>
      <span className="fv-originator-dot" style={{ background: color }} aria-hidden="true" />
      <span className="fv-originator-who">{originator}</span>
    </>
  )
  if (alive && onOpenSession) {
    return (
      <button type="button" className="fv-originator alive openable" data-tip={title} aria-label={title} onClick={() => onOpenSession(originator)}>
        {body}
      </button>
    )
  }
  return (
    <span className={`fv-originator ${alive ? 'alive' : 'offline'}`}
          data-tip={title}>
      {body}
    </span>
  )
}

// Over a clip ([[event-detail]]) the reply list is the review track: `selIdx`/`activeIdx` mark the explicitly
// selected and the playhead-inside comments (in sync with the scrubber's markers), and clicking an anchor
// chip both seeks AND selects (`onSelect(i, tMs)`) so keyboard jumps and marker clicks share one selection.
// Off a clip these are all absent and a reply renders exactly as before. `events` is the viewed reading's
// step timeline: each anchor is resolved by STEP-NAME against it (E2, resolveAnchor) so its moment tracks a
// re-measure, degrading to a readable-not-seekable chip when the step is gone. A reply that is a REMARK
// ([[remark-substrate]] — it carries `rid`) shows its `resolved` bit: a resolved remark renders settled
// (dimmed, ✓), an open one prominent — the loss the eval scoreboard is still carrying, made visible in place.
// The bit is also WRITABLE here at CLI parity ([[remark-substrate]] LAW L): when the home passes `threadId`
// + `onRemarkChange`, an unresolved remark carries its one applicable verb — RESOLVE on an agent's remark
// (the human's second-party judgment; never on the human's own, mirroring the server's self-resolve
// rejection) or RETRACT on the human's own (author-only withdrawal) — POSTing the `<threadId>#<rid>` ref to
// the same endpoints `spex resolve`/`spex retract` parallel. A resolved remark is settled and immutable
// (monotonic — no un-resolve, no retract past a resolve), so it renders no verb.
export function Replies({ replies, onSeek, selIdx = null, activeIdx = null, onSelect = null, events = null, threadId = null, onRemarkChange = null }) {
  const t = useT()
  const [acting, setActing] = useState(null)   // the ref in flight — one action at a time
  const [actErr, setActErr] = useState(null)   // { ref, msg } — a refused action surfaces on its row, never swallows
  const act = async (action, ref) => {
    if (acting) return
    setActing(ref); setActErr(null)
    try {
      const res = await postRemarkAction(action, ref)
      if (res?.ok) await onRemarkChange?.()
      else setActErr({ ref, msg: res?.error || `${action} failed` })
    } finally { setActing(null) }
  }
  return replies.map((r, i) => {
    const parsed = parseAnchor(r.body)
    const a = resolveAnchor(parsed, events)              // E2: canonical step → the current clip's live tMs
    const src = parsed ? parsed.rest : r.body
    const media = [...src.matchAll(BLOB_MD)].map((m) => m[1])   // linked blobs render as media, not raw md
    const prose = (media.length ? src.replace(BLOB_MD, '') : src).trim()
    const isRemark = r.rid !== undefined
    const remarkCls = isRemark ? (r.resolved ? ' remark resolved' : ' remark open') : ''
    const cls = `fv-reply${selIdx === i ? ' sel' : ''}${activeIdx === i ? ' active' : ''}${remarkCls}`
    const seek = a && a.seekable && onSeek ? () => (onSelect ? onSelect(i, a.tMs) : onSeek(a.tMs)) : null
    const ref = isRemark && threadId ? `${threadId}#${r.rid}` : null
    return (
      <div className={cls} key={i}>
        <div className="fv-reply-meta">
          <span className="fv-reply-by">{r.by}</span>
          {r.at && <span className="fv-reply-at">{r.at}</span>}
          {a && (seek
            ? <button type="button" className="fv-anchor" onClick={seek} data-tip="seek the clip to this moment">{a.label}</button>
            : <span className={`fv-anchor static${a.degraded ? ' degraded' : ''}`} data-tip={a.degraded ? t('thread.anchorDegraded') : undefined}>{a.label}{a.degraded ? ' ⚠' : ''}</span>)}
          {isRemark && (r.resolved
            ? <span className="fv-remark-state resolved" data-tip={r.resolvedBy ? t('thread.resolvedBy', { by: r.resolvedBy }) : t('thread.resolved')}>✓ {t('thread.resolved')}</span>
            : <span className="fv-remark-state open" data-tip={t('thread.openRemark')}>● {t('thread.openRemark')}</span>)}
          {ref && onRemarkChange && !r.resolved && (r.by === 'human'
            ? <button type="button" className="fv-remark-act retract" disabled={!!acting} data-tip={t('thread.retractTitle')} onClick={() => act('retract', ref)}>{t('thread.retract')}</button>
            : <button type="button" className="fv-remark-act resolve" disabled={!!acting} data-tip={t('thread.resolveTitle')} onClick={() => act('resolve', ref)}>{t('thread.resolve')}</button>)}
        </div>
        {actErr && actErr.ref === ref && <div className="fv-error">{actErr.msg}</div>}
        {prose && <div className="fvd-body"><SpecBody body={prose} /></div>}
        {media.length > 0 && (
          <div className="fv-reply-media">
            {media.map((h, k) => <BlobMedia hash={h} alt="evidence" key={`${h}-${k}`} />)}
          </div>
        )}
      </div>
    )
  })
}

// the review-track `/` trigger ([[review-commands]]) — the session box's leading-`/` grammar, applied per
// LINE: a `/token` from the start of the caret's line to the caret opens the command menu. Line-start (not
// value-start) so a stamped `▶` anchor or a circled frame above never disarms the trigger — the natural
// review flow is circle → type `/refuse` on the fresh line below the anchor. No matching command (the
// when-gates already filtered the list) → no menu, exactly like the console.
function slashAt(value, caret, commands) {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1
  const m = /^\/(\S*)$/.exec(value.slice(lineStart, caret))
  if (!m) return null
  const items = matchSlash(commands, m[1])
  if (!items.length) return null
  return { items, index: 0, start: lineStart, end: caret, query: m[1] }
}

// the ONE docked composer, shared by every home ([[issues-view]] / [[event-detail]]): a QUIET BORDERED
// container holding a BORDERLESS writing surface over a PERSISTENT compact action row. The writing
// surface is already usable at idle — floored at two lines, never a one-line sliver and never a
// click-to-expand — and auto-grows with the draft ABOVE that floor (the shared fitTextarea, floored by
// CSS min-height, capped by CSS max-height so it never eats the pane). The action row is always visible
// and carries only real acts: the contextual ⏱ anchor stamp (where a clip supplies one), any
// host-supplied lifecycle action (Close issue / Promote via `actionsEnd`), and the icon-only Send pinned
// at the right edge; a failed send surfaces its error in the same row, never out of view.
// Posts through the caller's `onSend(text, evidence)` as 'human'. An @-mention in the text summons a worker; the returned outcomes
// string surfaces via onDone. The textarea carries the SAME `[[node]]`/`@session` autocomplete as the
// console ([[mentions]], one shared menu, never a fork); the composer is docked at the detail's bottom,
// so its menu opens UPWARD, as an overlay above the container. The thread's own node leads the `[[` list. Over a clip the home passes
// `anchorNow()` (async → { tMs, step, frame }) → a ⏱ button stamps the current moment's `▶m:ss · step`
// AND its captured frame at the body's head; a circle pushes a `draft` (prefilled anchored body + the
// rect-burned frame link) — either way a mark is thereafter an ordinary — replyable, @-able — reply,
// its frame indexed as the thread's evidence[].
export function ReplyComposer({ onSend, specs = [], sessions = [], focusId = null, onDone, anchorNow = null, draft = null, actionsEnd = null, commands = null }) {
  const t = useT()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')       // a failed send (a forge can be unreachable) surfaces, never swallows
  const taRef = useRef(null)
  const { launchers } = useLaunchers()
  const ac = useMentionAutocomplete({ inputRef: taRef, value: body, setValue: setBody, specs, sessions, launchers, focusId, up: true })
  // the review-track `/` menu ([[review-commands]]) — armed only when the home passes `commands` (the eval
  // detail; the issue composers pass none and keep their exact old surface). Two command kinds, one menu:
  // a BUILT-IN verb (`run`) fires the SAME closure its header button calls (reviewCommands.js, so button
  // and command never drift) after the typed token is removed; a PRESET (`prefill`) replaces the draft
  // with its filled template, keeping a stamped `▶` anchor head (the anchor line + its own riding frame).
  const [slash, setSlash] = useState(null)
  const syncSlash = (el) => setSlash(el && commands?.length ? slashAt(el.value, el.selectionStart, commands) : null)
  const acceptSlash = (item) => {
    if (!item || !slash) return
    const rest = body.slice(0, slash.start) + body.slice(slash.end)
    setSlash(null)
    if (item.run) { setBody(rest.trim() ? rest : ''); item.run(); return }
    const ex = parseAnchor(rest)
    let head = ''
    if (ex) {
      const frame = HEAD_FRAME_RE.exec(ex.rest)?.[0] ?? ''
      head = `${ex.label}\n${frame}`
      if (!head.endsWith('\n')) head += '\n'
    }
    setBody(head + item.prefill())
    requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } })
  }
  const onSlashKey = (e) => {
    if (!slash) return false
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setSlash((m) => ({ ...m, index: (m.index + 1) % m.items.length })); return true }
    if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSlash((m) => ({ ...m, index: (m.index - 1 + m.items.length) % m.items.length })); return true }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); acceptSlash(slash.items[slash.index]); return true }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSlash(null); return true }
    return false
  }
  const frames = bodyEvidence(body)         // the frame links currently in the draft (preview + the send's evidence[])

  // auto-grow like the ❯ box, but floored at a USABLE idle height: refit on every draft change. The floor
  // (CSS min-height) is the idle writing surface — two lines, already usable with no click-to-expand;
  // autogrow lives above it, capped by CSS max-height so it never eats the pane. Both bounds are read from
  // the textarea's own CSS, so the composer's geometry stays one source of truth.
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    const cs = getComputedStyle(ta)
    fitTextarea(ta, parseFloat(cs.maxHeight) || Infinity, parseFloat(cs.minHeight) || 0)
  }, [body])

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

  // ⏱ — stamp (or re-stamp) the current moment as this comment's anchor: the `▶m:ss · step` line PLUS the
  // frame image itself ([[event-detail]]: an anchored mark carries its moment's frame), keeping the prose
  // below. A frame link riding at the HEAD of the prose (right under the anchor line) is the anchor's OWN
  // frame — a re-stamp replaces it along with the line, so an anchor and its frame never disagree; frames
  // the author placed deeper in the prose are theirs, untouched. A capture miss (frame: null) degrades to
  // the text-only line, never a blocked stamp.
  const stampAnchor = async () => {
    const a = await anchorNow?.()
    if (!a) return
    const head = anchorLine(a.tMs, a.step) + (a.frame ? `\n![frame](/api/evidence/${a.frame})` : '')
    setBody((b) => {
      const ex = parseAnchor(b)
      const rest = (ex ? ex.rest : b).replace(HEAD_FRAME_RE, '')
      return rest ? `${head}\n${rest}` : `${head}\n`
    })
    taRef.current?.focus()
  }

  // the grammar's two discoverability doors ([[mentions]]): insert the EXACT trigger (`@` / `[[`) at the
  // caret — replacing any selection, preserving the rest of the draft — then refocus with the caret right
  // after it and re-run the ONE shared autocomplete sync, so the same menu typing the trigger opens opens
  // here too. No second menu, no dispatch: the button only types what the hand would.
  const insertTrigger = (trigger) => {
    const el = taRef.current
    if (!el || busy) return
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? start
    setBody(body.slice(0, start) + trigger + body.slice(end))
    const caret = start + trigger.length
    requestAnimationFrame(() => {
      const ta = taRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(caret, caret)
      ac.sync(ta)
      syncSlash(ta)
    })
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
          {frames.map((h) => <BlobMedia hash={h} alt="frame" key={h} />)}
        </div>
      )}
      <div className="fv-tawrap">
        <textarea ref={taRef} className="fv-textarea" rows={1} value={body} placeholder={t('session.issuesReplyPlaceholder')}
          disabled={busy} onChange={(e) => { setBody(e.target.value); ac.sync(e.target); syncSlash(e.target) }}
          onSelect={(e) => { ac.sync(e.target); syncSlash(e.target) }} onBlur={() => { ac.close(); setSlash(null) }}
          onKeyDown={(e) => { if (onSlashKey(e)) return; if (ac.onKeyDown(e)) return; if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }} />
        {ac.menuEl}
        {slash && <SlashMenu menu={slash} up head={slash.query ? `/${slash.query}` : t('annotator.menuReview')}
          onPick={acceptSlash} onHover={(i) => setSlash((m) => (m ? { ...m, index: i } : m))} />}
      </div>
      {/* the buttons swallow mousedown so a click never blurs the textarea; the row itself is persistent. */}
      <div className="fv-actions">
        <button type="button" className="fv-trigger-btn" data-tip={t('thread.mentionActor')} aria-label={t('thread.mentionActor')}
          onMouseDown={(e) => e.preventDefault()} onClick={() => insertTrigger('@')}>@</button>
        <button type="button" className="fv-trigger-btn" data-tip={t('thread.mentionNode')} aria-label={t('thread.mentionNode')}
          onMouseDown={(e) => e.preventDefault()} onClick={() => insertTrigger('[[')}>[[</button>
        {anchorNow && <button type="button" className="fv-anchor-btn" data-tip={t('thread.anchorTitle')} onMouseDown={(e) => e.preventDefault()} onClick={stampAnchor}><Icon name="clock" size={11} /> {t('thread.anchorNow')}</button>}
        {err && <span className="fv-error">{err}</span>}
        <div className="fv-actions-end">
          {actionsEnd}
          <IconButton icon="send" size={14} className="fv-send" label={busy ? t('session.issuesSending') : t('session.issuesSend')}
            disabled={busy || !body.trim()} onMouseDown={(e) => e.preventDefault()} onClick={send} />
        </div>
      </div>
    </div>
  )
}
