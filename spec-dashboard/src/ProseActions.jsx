import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import { useT } from './i18n/index.jsx'
import { useBoard, useWorkspaceApi } from './workspace.jsx'
import { useTransientNotice } from './TransientNotice.jsx'
import { useEscLayer } from './escStack.js'
import { encodePrompt } from './codeSelection.js'
import { proseSelection, PROSE_PRESETS, regionText, stampedRange } from './proseSelection.js'
import { postSpecBody, sendSessionText } from './data.js'
import { useSpecContent } from './NodeView.jsx'
import { sessionHeadline } from './session.js'
import { navigate } from './route.js'

// [[prose-dispatch]]: what a reader can DO with a passage of spec prose they just selected.
//
// Three things, and the difference between them is only where the answer lands:
//   · hand the passage to a session as context, and keep reading (the board does not move);
//   · hand it over and FOLLOW it, because the answer is the thing you wanted (Explain);
//   · change the passage yourself, right here, and land it as a commit ([[spec-body-edit]]).
//
// The first two are the SAME send. There is no second dispatch path, no selection route, no session field:
// the passage becomes an ordinary [[code-selection]] token inside an ordinary prompt, and it travels the
// one input channel every other surface uses ([[dispatch]]). "Jump to Session" is a navigation that happens
// after the send returns — the message is identical either way, which is why it can be a checkbox and not
// a mode.
//
// Everything here FLOATS. An action group and a popover are z-layers over the document, never a strip
// added to the chrome — the reading column keeps its full width whether or not anything is selected
// ([[ui-state-model]]'s band budget).

const GAP = 8

// clamp a floating card into the viewport, measured after it renders so its own size is known.
function useAnchored(x, y, deps) {
  const ref = useRef(null)
  const [style, setStyle] = useState({ left: x, top: y, visibility: 'hidden' })
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    setStyle({
      left: Math.max(GAP, Math.min(x, window.innerWidth - rect.width - GAP)),
      top: Math.max(GAP, Math.min(y, window.innerHeight - rect.height - GAP)),
      visibility: 'visible',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, ...deps])
  return [ref, style]
}

// the four verbs. `preset` seeds the popover's message; `jump` is the DEFAULT send mode for that verb —
// Explain follows the answer because the answer is the point, the others stay put because the reading is.
const ACTIONS = [
  { key: 'send', icon: 'send', preset: null, jump: false },
  { key: 'editSend', icon: 'message-square', preset: 'edit', jump: false },
  { key: 'explain', icon: 'info', preset: 'explain', jump: true },
  { key: 'manual', icon: 'pencil', preset: null, jump: false },
]

export default function ProseActions({ node, hostRef }) {
  const t = useT()
  const { sessions = [] } = useBoard()
  const { setCompose } = useWorkspaceApi()
  const { notify } = useTransientNotice()
  const content = useSpecContent(node?.id, node?.version)
  const body = node?.body ?? content?.body ?? ''

  const [hit, setHit] = useState(null)        // { lines, x, y } — a live selection and where to point at it
  const [panel, setPanel] = useState(null)    // { kind:'send'|'manual', x, y, preset, jump }
  const [draft, setDraft] = useState('')      // the popover's optional message / the editor's replacement
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const live = sessions.filter((s) => !s?.archived)
  const dismiss = useCallback(() => { setPanel(null); setError(null); setBusy(false) }, [])
  const clear = useCallback(() => { setHit(null); dismiss() }, [dismiss])

  // WHERE THE LINE NUMBERS COME FROM. The renderer stamped each block with its body lines
  // ([[prose-selection]]); a selection is read back through those stamps on mouse-up, never by measuring
  // text. No stamps under the selection (the title, the meta row, a node whose parts could not be placed)
  // means no actions — silence rather than a guessed range.
  useEffect(() => {
    const host = hostRef?.current
    if (!host) return undefined
    const read = () => {
      const sel = document.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setHit(null); return }
      const range = sel.getRangeAt(0)
      if (!host.contains(range.commonAncestorContainer)) return    // a selection elsewhere is not ours to clear
      const lines = stampedRange(range, host)
      if (!lines) { setHit(null); return }
      const rect = range.getBoundingClientRect()
      setHit({ lines, x: rect.left, y: rect.top })
    }
    const later = () => window.setTimeout(read, 0)
    host.addEventListener('mouseup', later)
    host.addEventListener('keyup', later)
    return () => { host.removeEventListener('mouseup', later); host.removeEventListener('keyup', later) }
  }, [hostRef])

  // the right-click face of the same group — same items, anchored at the pointer instead of the passage.
  useEffect(() => {
    const host = hostRef?.current
    if (!host) return undefined
    const onMenu = (event) => {
      const sel = document.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
      const lines = stampedRange(sel.getRangeAt(0), host)
      if (!lines) return
      event.preventDefault()
      setPanel(null)
      setHit({ lines, x: event.clientX, y: event.clientY + 18 })
    }
    host.addEventListener('contextmenu', onMenu)
    return () => host.removeEventListener('contextmenu', onMenu)
  }, [hostRef])

  useEscLayer(!!panel, dismiss)
  useEscLayer(!!hit && !panel, clear)

  // an outside press closes the open card. Bound while a card is open only, so ordinary reading never pays
  // for a document-level listener.
  useEffect(() => {
    if (!panel) return undefined
    const onDown = (event) => { if (!event.target.closest?.('.pa-card')) dismiss() }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [panel, dismiss])

  const selection = hit ? proseSelection(node, body, hit.lines) : null

  const open = (action, event) => {
    const x = event?.clientX ?? hit?.x ?? 0
    const y = (event?.clientY ?? hit?.y ?? 0) + 14
    setError(null)
    if (action.key === 'manual') {
      setDraft(regionText(body, hit.lines.startLine, hit.lines.endLine))
      setPanel({ kind: 'manual', x, y })
      return
    }
    setDraft(action.preset ? t(`proseActions.prompt.${action.preset}`) : '')
    if (!target && live.length) setTarget(live[0].id)
    setPanel({ kind: 'send', x, y, jump: action.jump })
  }

  const send = async (jump) => {
    if (!selection) return
    const to = target || 'new'
    const prompt = encodePrompt(draft, [selection])
    // "new" is a DRAFT, not a dispatch: a session that does not exist yet cannot receive a message, so the
    // passage rides the same one-shot compose handoff the board already uses and the human presses send.
    if (to === 'new') {
      setCompose(prompt)
      clear()
      navigate('sessions', 'new')
      return
    }
    setBusy(true)
    setError(null)
    const res = await sendSessionText(to, prompt)
    setBusy(false)
    if (!res.ok) { setError(res.error || t('proseActions.sendFailed')); return }
    const name = sessionHeadline(live.find((s) => s.id === to)) || to.slice(0, 8)
    notify(t('proseActions.sentTo', { name }), { kind: 'success' })
    clear()
    if (jump) navigate('sessions', to)
  }

  const commit = async () => {
    if (!hit) return
    setBusy(true)
    setError(null)
    try {
      const result = await postSpecBody(node.id, {
        startLine: hit.lines.startLine,
        endLine: hit.lines.endLine,
        original: regionText(body, hit.lines.startLine, hit.lines.endLine),
        replacement: draft,
      })
      setBusy(false)
      notify(result.changed ? t('proseActions.committed', { sha: (result.commit || '').slice(0, 7) }) : t('proseActions.noChange'),
        { kind: result.changed ? 'success' : 'info' })
      clear()
    } catch (e) {
      setBusy(false)
      // loud, and specific: a region that moved shows what is there now, so the human sees the collision
      // rather than a generic failure.
      setError(e?.current ? `${e.message}\n\n${e.current}` : String(e?.message || e))
    }
  }

  if (!node || !selection) return null
  return (
    <>
      {!panel && <ActionGroup t={t} hit={hit} onPick={open} />}
      {panel?.kind === 'send' && (
        <SendPopover t={t} panel={panel} selection={selection} sessions={live} target={target} setTarget={setTarget}
          draft={draft} setDraft={setDraft} busy={busy} error={error} onSend={send} onClose={dismiss} />
      )}
      {panel?.kind === 'manual' && (
        <ManualEditor t={t} panel={panel} node={node} lines={hit.lines} draft={draft} setDraft={setDraft}
          busy={busy} error={error} onCommit={commit} onClose={dismiss} />
      )}
    </>
  )
}

// The group that follows the passage. `role="menu"` and a fixed position: an overlay, counted as a z-layer
// and never as chrome. preventDefault on press keeps the browser selection alive under it — losing the
// selection on the way to acting on it is the one bug this affordance cannot have.
function ActionGroup({ t, hit, onPick }) {
  const [ref, style] = useAnchored(hit.x, hit.y - 44, [hit.lines.startLine, hit.lines.endLine])
  return (
    <div ref={ref} className="pa-group" role="menu" aria-label={t('proseActions.groupLabel')} style={style}>
      {ACTIONS.map((action) => (
        <button key={action.key} type="button" role="menuitem" className="pa-act"
          onMouseDown={(event) => event.preventDefault()} onClick={(event) => onPick(action, event)}>
          <Icon name={action.icon} size={13} className="pa-act-icon" />
          {t(`proseActions.act.${action.key}`)}
        </button>
      ))}
    </div>
  )
}

function SelectionChip({ t, selection }) {
  return (
    <div className="pa-chip" title={selection.text}>
      <Icon name="file-diff" size={12} />
      <span className="pa-chip-label">{t('proseActions.lines', { a: selection.startLine, b: selection.endLine })}</span>
      <span className="pa-chip-node">{selection.node}</span>
    </div>
  )
}

// The message box beside the pointer: an optional note, the three preset intents, who receives it, and the
// two send modes. Nothing here is required — an empty message sends the passage alone, which is the whole
// point of "here, look at this".
function SendPopover({ t, panel, selection, sessions, target, setTarget, draft, setDraft, busy, error, onSend, onClose }) {
  const [ref, style] = useAnchored(panel.x, panel.y, [])
  const box = useRef(null)
  useEffect(() => { box.current?.focus() }, [])
  return (
    <div ref={ref} className="pa-card pa-send" role="dialog" aria-label={t('proseActions.sendLabel')} style={style}>
      <SelectionChip t={t} selection={selection} />
      <textarea ref={box} className="pa-input" rows={3} value={draft} placeholder={t('proseActions.messagePlaceholder')}
        onChange={(event) => setDraft(event.target.value)} />
      <div className="pa-presets">
        {PROSE_PRESETS.map((preset) => (
          <button key={preset} type="button" className="pa-preset" onClick={() => setDraft(t(`proseActions.prompt.${preset}`))}>
            {t(`proseActions.preset.${preset}`)}
          </button>
        ))}
      </div>
      <label className="pa-target">
        <span className="pa-target-label">{t('proseActions.target')}</span>
        <select className="pa-select" value={target} onChange={(event) => setTarget(event.target.value)}>
          {sessions.map((s) => <option key={s.id} value={s.id}>{sessionHeadline(s) || s.id.slice(0, 8)}</option>)}
          <option value="new">{t('proseActions.newSession')}</option>
        </select>
      </label>
      {error && <div className="pa-error" role="alert">{error}</div>}
      <div className="pa-foot">
        <button type="button" className="pa-btn" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="pa-btn" disabled={busy} onClick={() => onSend(false)}>{t('proseActions.send')}</button>
        <button type="button" className="pa-btn pa-go" disabled={busy} onClick={() => onSend(true)}>{t('proseActions.sendJump')}</button>
      </div>
    </div>
  )
}

// The in-place editor. It holds the passage's SOURCE lines, verbatim — not the rendered text — because the
// bytes it commits are the bytes in the file. What it sends back is the region it was opened with, so the
// server can refuse an edit whose ground moved ([[spec-body-edit]]).
function ManualEditor({ t, panel, node, lines, draft, setDraft, busy, error, onCommit, onClose }) {
  const [ref, style] = useAnchored(panel.x, panel.y, [])
  const box = useRef(null)
  useEffect(() => { box.current?.focus() }, [])
  return (
    <div ref={ref} className="pa-card pa-edit" role="dialog" aria-label={t('proseActions.editLabel')} style={style}>
      <div className="pa-edit-head">
        <Icon name="pencil" size={12} />
        <span className="pa-edit-where">{node.path}</span>
        <span className="pa-edit-lines">{t('proseActions.lines', { a: lines.startLine, b: lines.endLine })}</span>
      </div>
      <textarea ref={box} className="pa-input pa-edit-input" rows={10} value={draft} spellCheck={false}
        onChange={(event) => setDraft(event.target.value)} />
      {error && <div className="pa-error" role="alert">{error}</div>}
      <div className="pa-foot">
        <span className="pa-note">{t('proseActions.editNote')}</span>
        <button type="button" className="pa-btn" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="pa-btn pa-go" disabled={busy} onClick={onCommit}>
          {busy ? t('proseActions.committing') : t('proseActions.commit')}
        </button>
      </div>
    </div>
  )
}
