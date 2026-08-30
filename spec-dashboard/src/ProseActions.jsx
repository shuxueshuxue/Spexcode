import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon, IconButton } from './icons.jsx'
import { Avatar } from './avatar.jsx'
import { useT } from './i18n/index.jsx'
import { useBoard } from './workspace.jsx'
import { useTransientNotice } from './TransientNotice.jsx'
import { useEscLayer } from './escStack.js'
import { encodePrompt } from './codeSelection.js'
import { proseSelection, PROSE_PRESETS, regionText, stampedRange } from './proseSelection.js'
import { postSpecBody, sendSessionText } from './data.js'
import { createSession, useLaunchers } from './launch.js'
import { useSpecContent } from './specContent.js'
import { overlaySessions, sessionDisplayState, sessionFooterState, sessionHeadline } from './session.js'
import { ComposerSurface, ComposerTextarea, composingKey } from './Composer.jsx'
import { menuKeyDown, slashTokenAt, SlashMenu, TriggerButton, typeTrigger, useMentionAutocomplete } from './mentions.jsx'
import SelectionAttachment from './SelectionAttachment.jsx'
import SessionPicker from './SessionPicker.jsx'
import { navigate } from './route.js'
import { copyAddress, specAddress } from './address.js'
import { markNewTab } from './tabs.js'

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
// after the send returns — the message is identical either way, which is why it is a toggle and not a mode.
//
// The send card is the fifth home of the ONE composer ([[composer]]): the same surface, textarea, `@`/`[[`
// autocomplete and `/` palette as Command Box, the New box and the thread reply. What is different here is
// only that the RECIPIENT has to be chosen — every other composer already stands inside its target — so
// the footer leads with an address chip: the `<id>` argument of `spex session send`, picked through the
// same `@` rows every other box completes with ([[mentions]]), while an `@` typed in the message stays a
// passive reference.
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

// the default recipient: a live session already on this node, else the newest live session, else a new one.
function defaultTarget(live, nodeId) {
  const here = nodeId ? live.filter((s) => s.node === nodeId) : []
  const pool = here.length ? here : live
  return [...pool].sort((a, b) => (b.created || 0) - (a.created || 0))[0]?.id || 'new'
}

export default function ProseActions({ node, hostRef, codeSelection = null, onCodeSelectionClear }) {
  const t = useT()
  const { sessions = [], specs = [] } = useBoard()
  const { launchers, launcher, pickLauncher } = useLaunchers()
  const { notify } = useTransientNotice()
  const content = useSpecContent(node?.id, node?.version)
  const body = node?.body ?? content?.body ?? ''
  const bodyReady = !!codeSelection || node?.body != null || content !== null
  const codeSelectionRef = useRef(null)
  if (codeSelection) codeSelectionRef.current = codeSelection
  const hitRef = useRef(null)

  const [hit, setHit] = useState(null)        // { lines, x, y } — a live selection and where to point at it
  const [menuOpen, setMenuOpen] = useState(false) // the action group is opened explicitly by the native context menu
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false) // node actions when no passage is selected
  const [panel, setPanel] = useState(null)    // { kind:'send'|'manual', x, y }
  const [draft, setDraft] = useState('')      // the card's optional message / the editor's replacement
  const [target, setTarget] = useState('')    // a live session id, or 'new' (its launcher is the remembered one)
  const [jump, setJump] = useState(false)     // follow the passage to its session after the send
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const activeCodeSelection = codeSelection || (menuOpen ? codeSelectionRef.current : null)

  const live = sessions.filter((s) => sessionFooterState(s) === 'live')
  // Closing the card also retires the action group that opened it. Keeping menuOpen true would make the
  // group paint for one frame when an outside press clears panel, before the selection listener catches up.
  const dismiss = useCallback(() => { setPanel(null); setMenuOpen(false); setNodeMenuOpen(false); setError(null); setBusy(false) }, [])
  const clear = useCallback(() => {
    setHit(null)
    setMenuOpen(false)
    setNodeMenuOpen(false)
    hitRef.current = null
    codeSelectionRef.current = null
    onCodeSelectionClear?.()
    dismiss()
  }, [dismiss, onCodeSelectionClear])

  useEffect(() => {
    // A source selection can collapse transiently when CodeMirror handles the right-button press.
    // Keep the menu state for that gesture; the ref below supplies the last lossless range.
    if (codeSelection) { setMenuOpen(false); setNodeMenuOpen(false) }
    if (!codeSelection) { setPanel(null); setError(null); setBusy(false) }
  }, [codeSelection?.path, codeSelection?.startLine, codeSelection?.endLine, codeSelection?.text])

  // An open card FREEZES the passage it was opened on. The cards are rendered inside the prose pane, so
  // clicking into the message box is a press inside the tracked host and the browser drops the document
  // selection the moment the caret lands in a textarea — tracking through that would pull the passage out
  // from under the card mid-sentence. Read through a ref so the listeners below stay registered once.
  const frozen = useRef(false)
  frozen.current = !!panel

  // WHERE THE LINE NUMBERS COME FROM. The renderer stamped each block with its body lines
  // ([[prose-selection]]); a selection is read back through those stamps on mouse-up, never by measuring
  // text. No stamps under the selection (the title, the meta row, a node whose parts could not be placed)
  // means no passage actions — the node menu below still offers actions for the document itself.
  useEffect(() => {
    const host = hostRef?.current
    if (!host) return undefined
    const read = () => {
      if (frozen.current) return
      const sel = document.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setHit(null); setMenuOpen(false); hitRef.current = null; return }
      const range = sel.getRangeAt(0)
      if (!host.contains(range.commonAncestorContainer)) return    // a selection elsewhere is not ours to clear
      const lines = stampedRange(range, host)
      if (!lines) { setHit(null); setMenuOpen(false); hitRef.current = null; return }
      const rect = range.getBoundingClientRect()
      const next = { lines, x: rect.left, y: rect.top }
      setHit(next)
      hitRef.current = next
      // Selecting with the primary button only records the range. The native context menu is the
      // deliberate gesture that opens the action group.
      setMenuOpen(false)
    }
    const later = (event) => {
      if (event.type === 'mouseup' && event.button !== 0) return
      window.setTimeout(read, 0)
    }
    host.addEventListener('mouseup', later)
    host.addEventListener('keyup', later)
    return () => { host.removeEventListener('mouseup', later); host.removeEventListener('keyup', later) }
  }, [hostRef])

  // the right-click face of the same group — same items, anchored at the pointer instead of the passage.
  useEffect(() => {
    const host = hostRef?.current
    if (!host) return undefined
    const onMenu = (event) => {
      if (frozen.current) return
      // CodeMirror owns source selections and may not expose them through the browser Selection API.
      // The parent has already captured the lossless range, so right-clicking that source uses the same
      // action group and pointer anchor as prose without guessing from DOM text.
      const sourceSelection = codeSelection || codeSelectionRef.current
      if (sourceSelection) {
        event.preventDefault()
        setPanel(null)
        setNodeMenuOpen(false)
        setMenuOpen(true)
        const next = { lines: { startLine: sourceSelection.startLine, endLine: sourceSelection.endLine }, x: event.clientX, y: event.clientY + 18 }
        setHit(next)
        hitRef.current = next
        return
      }
      const sel = document.getSelection()
      const domLines = sel && !sel.isCollapsed && sel.rangeCount > 0
        ? stampedRange(sel.getRangeAt(0), host)
        : null
      const lines = domLines || hitRef.current?.lines
      if (!lines) {
        // A reader can act on the node itself even when the native Selection is empty. Links and controls
        // keep their browser menu; plain prose opens the node-level send/copy group instead.
        if (!node) return
        if (event.target.closest?.('a,button,input,textarea,select')) return
        event.preventDefault()
        setPanel(null)
        setMenuOpen(false)
        setNodeMenuOpen(true)
        setHit({ lines: null, x: event.clientX, y: event.clientY + 18 })
        hitRef.current = null
        return
      }
      event.preventDefault()
      setPanel(null)
      setNodeMenuOpen(false)
      setMenuOpen(true)
      const next = { lines, x: event.clientX, y: event.clientY + 18 }
      setHit(next)
      hitRef.current = next
    }
    host.addEventListener('contextmenu', onMenu, true)
    return () => host.removeEventListener('contextmenu', onMenu, true)
  }, [hostRef, codeSelection?.path, codeSelection?.startLine, codeSelection?.endLine, codeSelection?.text])

  // the send card layers its own Escape (menu → address → card); the editor and the bare group are one layer.
  useEscLayer(panel?.kind === 'manual', dismiss)
  useEscLayer(!!(hit || activeCodeSelection || nodeMenuOpen) && !panel, clear)

  // an outside press closes the open card. Bound while a card is open only, so ordinary reading never pays
  // for a document-level listener.
  useEffect(() => {
    if (!panel) return undefined
    const onDown = (event) => { if (!event.target.closest?.('.pa-card')) dismiss() }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [panel, dismiss])

  // Bare action groups follow the same dismissal contract as every other context menu: an outside
  // press closes it, and a new right-click gets a fresh anchor rather than leaving the old group behind.
  useEffect(() => {
    if ((!menuOpen && !nodeMenuOpen) || panel) return undefined
    const onClick = (event) => { if (!event.target.closest?.('.pa-group')) clear() }
    const onContext = () => clear()
    window.addEventListener('click', onClick)
    window.addEventListener('contextmenu', onContext, true)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('contextmenu', onContext, true)
    }
  }, [menuOpen, nodeMenuOpen, panel, clear])

  const nodeSelection = node && bodyReady ? {
    node: node.id,
    path: node.path,
    startLine: 1,
    endLine: Math.max(1, body.split('\n').length),
    text: body,
  } : null
  const selection = activeCodeSelection || (hit?.lines && (bodyReady
    ? proseSelection(node, body, hit.lines)
    : { node: node?.id, path: node?.path, startLine: hit.lines.startLine, endLine: hit.lines.endLine, text: '' })) || (nodeMenuOpen ? nodeSelection : null)
  const loading = !activeCodeSelection && !!(hit || nodeMenuOpen) && !bodyReady

  const open = (action, event) => {
    const x = event?.clientX ?? hit?.x ?? selection?.x ?? 0
    const y = (event?.clientY ?? hit?.y ?? selection?.y ?? 0) + 14
    setError(null)
    if (action.key === 'manual' && !activeCodeSelection) {
      setDraft(regionText(body, hit.lines.startLine, hit.lines.endLine))
      setPanel({ kind: 'manual', x, y })
      return
    }
    setDraft(action.preset ? t(`proseActions.prompt.${action.preset}`) : '')
    if (!live.some((s) => s.id === target)) setTarget(defaultTarget(live, node?.id))
    setJump(action.jump)
    setPanel({ kind: 'send', x, y })
  }
  // the address chip's pick: a session id, or a new session — with the launcher it named, remembered the
  // way the New tab remembers its own pick, so the two launch doors never disagree.
  const address = ({ id, launcher: name }) => {
    setTarget(id)
    if (id === 'new' && name && launchers.some((l) => l.name === name)) pickLauncher(name)
  }

  const send = async () => {
    if (!selection) return
    const to = target || 'new'
    const prompt = encodePrompt(draft, [selection])
    // A new target is dispatched in the same request that creates it. The returned id is the only reliable
    // route to the timeline; handing off to the launch composer would require a second human send.
    if (to === 'new') {
      setBusy(true)
      setError(null)
      const res = await createSession(prompt, launcher)
      setBusy(false)
      if (!res.ok) { setError(res.error || t('proseActions.sendFailed')); return }
      notify(t('proseActions.sentTo', { name: sessionHeadline(res.session) || res.id?.slice(0, 8) || t('proseActions.newSession') }), { kind: 'success' })
      clear()
      // Creation is a new-document gesture ([[tab-routing]]): hold the published id before the route write so the
      // new session appends beside the document the passage came from instead of replacing its tab.
      if (res.id) { markNewTab('sessions', res.id, null); navigate('sessions', res.id) }
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

  const copyNode = async () => {
    if (await copyAddress(specAddress(node.id))) { setNodeMenuOpen(false); notify(t('proseActions.nodeCopied'), { kind: 'success' }) }
  }
  // the node->session crossing, on the document's own menu ([[node-menu]]). A wiki-link reference lands a
  // reader on `#/spec/<id>`, where the graph's tile menu is out of reach; the same shared join and the same
  // [[session-picker]] rows keep that landing from being a dead end. Crossing closes the menu first — it
  // navigates away, and the menu must not outlive the page it was opened over.
  const crossings = overlaySessions(node, sessions)
  const crossTo = (id) => { setNodeMenuOpen(false); navigate('sessions', id) }
  if ((!node && !activeCodeSelection) || (!selection && !loading && !nodeMenuOpen)) return null
  const anchor = {
    lines: hit?.lines || { startLine: selection?.startLine || 1, endLine: selection?.endLine || 1 },
    x: hit?.x ?? selection?.x ?? 0,
    y: hit?.y ?? selection?.y ?? 0,
  }
  return (
    <>
      {!panel && menuOpen && selection && <ActionGroup t={t} hit={anchor} disabled={loading} manualEnabled={!activeCodeSelection} onPick={open} />}
      {!panel && nodeMenuOpen && <NodeActionGroup t={t} hit={anchor} disabled={loading} onSend={(event) => open({ key: 'send', preset: null, jump: false }, event)} onCopy={copyNode} crossings={crossings} onCross={crossTo} />}
      {!panel && menuOpen && loading && <span className="pa-loading" role="status" style={{ left: anchor.x, top: anchor.y }}><span className="spinner" aria-label={t('common.loading')} /></span>}
      {panel?.kind === 'send' && (
        <SendPopover t={t} panel={panel} node={node} selection={selection} specs={specs} sessions={sessions} live={live}
          launchers={launchers} launcher={launcher} target={target} onAddress={address} jump={jump} setJump={setJump}
          draft={draft} setDraft={setDraft} busy={busy} error={error} onSend={send} onRemove={clear} onClose={dismiss} />
      )}
      {panel?.kind === 'manual' && (
        <ManualEditor t={t} panel={panel} node={node} lines={hit.lines} draft={draft} setDraft={setDraft}
          busy={busy} error={error} onCommit={commit} onClose={dismiss} />
      )}
    </>
  )
}

// The group opened by the native context menu. `role="menu"` and a fixed position: an overlay, counted as a z-layer
// and never as chrome. preventDefault on press keeps the browser selection alive under it — losing the
// selection on the way to acting on it is the one bug this affordance cannot have.
function ActionGroup({ t, hit, onPick, disabled = false, manualEnabled = true }) {
  const [ref, style] = useAnchored(hit.x, hit.y - 44, [hit.lines.startLine, hit.lines.endLine])
  return (
    <div ref={ref} className="pa-group" role="menu" aria-label={t('proseActions.groupLabel')} style={style}>
      {ACTIONS.map((action) => (
        <button key={action.key} type="button" role="menuitem" className="pa-act"
          disabled={disabled || (action.key === 'manual' && !manualEnabled)}
          onMouseDown={(event) => event.preventDefault()} onClick={(event) => onPick(action, event)}>
          <Icon name={action.icon} size={13} className="pa-act-icon" />
          {t(`proseActions.act.${action.key}`)}
        </button>
      ))}
    </div>
  )
}

function NodeActionGroup({ t, hit, onSend, onCopy, disabled = false, crossings = [], onCross }) {
  const [ref, style] = useAnchored(hit.x, hit.y - 44, [])
  return (
    <div ref={ref} className="pa-group pa-node-group" role="menu" aria-label={t('proseActions.nodeGroupLabel')} style={style}>
      <button type="button" role="menuitem" className="pa-act" disabled={disabled}
        onMouseDown={(event) => event.preventDefault()} onClick={onSend}>
        <Icon name="send" size={13} className="pa-act-icon" />
        {t('proseActions.nodeSend')}
      </button>
      <button type="button" role="menuitem" className="pa-act" onMouseDown={(event) => event.preventDefault()} onClick={onCopy}>
        <Icon name="copy" size={13} className="pa-act-icon" />
        {t('proseActions.nodeCopy')}
      </button>
      {crossings.length > 0 && (
        <SessionPicker sessions={crossings} value="" onChange={onCross} filter={crossings.length > 4} compact
          className="sess-menu-picker" ariaLabel={t('sessionPicker.overlaySessions')} />
      )}
    </div>
  )
}

// The send card beside the pointer — the shared composer shell wearing this surface's one extra: an
// address. Preview slot: the passage as the shared attachment row. Editor: the message, optional, with
// the same `@` / `[[` autocomplete as every other box and the three preset intents as `/` commands (a
// preset is text the human can still change, so it lands in the draft like any other completion).
// Footer: the address chip, the three grammar doors, the follow toggle, and the icon-only Send. Nothing
// here is required — an empty message sends the passage alone, which is the whole point of "look at this".
function SendPopover({ t, panel, node, selection, specs, sessions, live, launchers, launcher, target, onAddress, jump, setJump,
  draft, setDraft, busy, error, onSend, onRemove, onClose }) {
  const [ref, style] = useAnchored(panel.x, panel.y, [])
  const box = useRef(null)
  // the card sits where the pointer was; a menu opens away from the nearer viewport edge.
  const up = panel.y > window.innerHeight * 0.55
  const [addressing, setAddressing] = useState(false)
  useEffect(() => { box.current?.focus() }, [])
  const ac = useMentionAutocomplete({ inputRef: box, value: draft, setValue: setDraft, specs, sessions, launchers, focusId: node?.id, up })
  const presets = PROSE_PRESETS.map((name) => ({ name, description: t(`proseActions.prompt.${name}`), kind: 'preset' }))
  const [slash, setSlash] = useState(null)
  const syncSlash = (el) => setSlash(el ? slashTokenAt(el.value, el.selectionStart, presets) : null)
  const acceptSlash = (item) => {
    if (!item || !slash) return
    const text = t(`proseActions.prompt.${item.name}`)
    setDraft(draft.slice(0, slash.start) + text + draft.slice(slash.end))
    setSlash(null)
    const caret = slash.start + text.length
    requestAnimationFrame(() => { const el = box.current; if (el) { el.focus(); el.setSelectionRange(caret, caret) } })
  }
  const sync = (el) => { ac.sync(el); syncSlash(el) }
  const insertTrigger = (trigger) => typeTrigger(box.current, trigger, setDraft, sync)
  // Escape peels ONE layer: an open menu, then the address editor, then the card — never the document under it.
  useEscLayer(true, () => {
    if (slash) setSlash(null)
    else if (ac.menu) ac.dismiss()
    else if (addressing) setAddressing(false)
    else onClose()
  })
  const pick = (to) => { onAddress(to); setAddressing(false); box.current?.focus() }
  return (
    <ComposerSurface ref={ref} className="pa-card pa-send" role="dialog" aria-label={t('proseActions.sendLabel')} style={style}
      preview={<SelectionAttachment selection={selection} onRemove={onRemove} />}
      editor={(
        <div className="fv-tawrap">
          <ComposerTextarea ref={box} className="pa-message" rows={1} value={draft} placeholder={t('proseActions.messagePlaceholder')}
            disabled={busy} spellCheck={false}
            onChange={(e) => { setDraft(e.target.value); sync(e.target) }} onSelect={(e) => sync(e.target)}
            onBlur={() => { ac.close(); setSlash(null) }}
            onKeyDown={(e) => {
              if (composingKey(e)) return
              if (menuKeyDown(e, slash, setSlash, acceptSlash)) return
              if (ac.onKeyDown(e)) return
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() }
            }} />
          {ac.menuEl}
          {slash && <SlashMenu menu={slash} up={up} head={slash.query ? `/${slash.query}` : t('session.menuPresets')}
            onPick={acceptSlash} onHover={(i) => setSlash((m) => (m ? { ...m, index: i } : m))} />}
          {error && <div className="pa-error" role="alert">{error}</div>}
        </div>
      )}
      footer={(
        <div className="pa-tools">
          {addressing
            ? <AddressInput t={t} live={live} launchers={launchers} launcher={launcher} up={up} onPick={pick} onCancel={() => { setAddressing(false); box.current?.focus() }} />
            : <AddressChip t={t} live={live} launcher={launcher} target={target} onOpen={() => setAddressing(true)} />}
          <TriggerButton label={t('thread.mentionActor')} disabled={busy} onClick={() => insertTrigger('@')}>@</TriggerButton>
          <TriggerButton label={t('thread.mentionNode')} disabled={busy} onClick={() => insertTrigger('[[')}>[[</TriggerButton>
          <TriggerButton label={t('proseActions.presets')} disabled={busy} onClick={() => insertTrigger('/')}>/</TriggerButton>
          <button type="button" className="pa-jump" aria-pressed={jump} data-tip={t('proseActions.jumpTip')}
            onMouseDown={(e) => e.preventDefault()} onClick={() => setJump(!jump)}>
            <Icon name="check" size={11} className="pa-jump-mark" />{t('proseActions.sendJump')}
          </button>
          <IconButton icon="send" size={14} className="icon-btn primary pa-submit" label={t('proseActions.send')}
            disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={onSend} />
        </div>
      )} />
  )
}

// the recipient at rest: the shared session identity (avatar + headline + lifecycle glyph) for a live
// target, or "new · <launcher>" — the launcher a new session would take, visible instead of implied.
function AddressChip({ t, live, launcher, target, onOpen }) {
  const session = live.find((s) => s.id === target)
  const display = session ? sessionDisplayState(session) : null
  return (
    <button type="button" className="pa-address" aria-label={t('proseActions.target')} data-tip={t('proseActions.addressTip')}
      onMouseDown={(e) => e.preventDefault()} onClick={onOpen}>
      {session
        ? <Avatar seed={session.id} status={display.status} size={13} />
        : <Icon name="plus" size={12} className="pa-address-new" />}
      <span className="pa-address-name">{session ? sessionHeadline(session) || session.id.slice(0, 8) : t('proseActions.newWith', { launcher: launcher || '' })}</span>
      {session && <span className="pa-address-state" style={{ color: display.color }} aria-label={t(`status.${display.status}`)}>{display.glyph}</span>}
      <Icon name="chevron-down" size={11} className="pa-address-caret" />
    </button>
  )
}

// the recipient being chosen: the `@` grammar in a one-line field — the same rows, ranking, `@new` and
// `@new:<launcher>` doors as the shared autocomplete, over the LIVE sessions only (the dispatch targets).
// An accepted row writes the token (`@<id> ` / `@new:<launcher> `) and that token IS the pick; Enter on
// a bare `@new` takes the remembered launcher. Blur or Escape leaves the address as it was.
function AddressInput({ t, live, launchers, launcher, up, onPick, onCancel }) {
  const inputRef = useRef(null)
  const [text, setText] = useState('@')
  const ac = useMentionAutocomplete({ inputRef, value: text, setValue: setText, sessions: live, launchers, up })
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus(); el.setSelectionRange(1, 1); ac.sync(el)
  }, [])
  const commit = (value) => {
    const m = /^@(?:new(?::(\S+))?|(\S+))\s*$/.exec(value)
    if (!m) return false
    if (m[2]) { if (!live.some((s) => s.id === m[2])) return false; onPick({ id: m[2] }); return true }
    onPick({ id: 'new', launcher: m[1] || launcher })
    return true
  }
  useEffect(() => { if (/\s$/.test(text)) commit(text) }, [text])
  return (
    <>
      <input ref={inputRef} className="pa-address pa-address-input" value={text} aria-label={t('proseActions.target')} spellCheck={false}
        onChange={(e) => { setText(e.target.value); ac.sync(e.target) }} onSelect={(e) => ac.sync(e.target)}
        onBlur={onCancel}
        onKeyDown={(e) => {
          if (composingKey(e)) return
          if (ac.onKeyDown(e)) return
          if (e.key === 'Enter') { e.preventDefault(); if (!commit(text)) onCancel() }
        }} />
      {ac.menuEl}
    </>
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
