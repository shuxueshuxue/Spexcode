import { useEffect, useRef, useState } from 'react'
import { ContextMenu, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator } from './ContextMenu.jsx'
import Modal from './Modal.jsx'
import SessionAttach from './SessionAttach.jsx'
import { apiFetch, loadSettings } from './data.js'
import { openNewTab } from './tabs.js'
import { sessionHeadline } from './session.js'
import { useEscLayer } from './escStack.js'
import { useT } from './i18n/index.jsx'

export default function SessionContextMenu({ menu, closeRequest = null, onCloseRequestDone, onClose, onChanged, onLock, onError, onMultiSelect, onDetach }) {
  const t = useT()
  const [renaming, setRenaming] = useState(null)   // the session whose rename prompt is open | null
  const [closing, setClosing] = useState(null)     // the session whose close-confirm prompt is open | null
  const [quarantining, setQuarantining] = useState(null) // corrupt row whose opaque record needs witnessed quarantine
  const [attaching, setAttaching] = useState(null) // the session whose attach modal is open | null ([[attach-menu]])
  const [tmuxSocket, setTmuxSocket] = useState('spexcode') // the private tmux server's -L label; the default until settings load
  const [value, setValue] = useState('')
  const [witness, setWitness] = useState({ adapter: 'claude', thread: '', tmux: '', worktree: '', branch: '' })
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  // the tmux socket is a backend fact (env-overridable), fetched once so the raw-tmux attach fallback names the
  // RIGHT server; the built-in default stands in until it lands and is harmless if the fetch never returns.
  useEffect(() => { loadSettings().then((s) => { if (s?.tmuxSocket) setTmuxSocket(s.tmuxSocket) }).catch(() => { /* keep the default */ }) }, [])

  // Standard outside-press dismissal, bound only while the menu is open — on MOUSEDOWN, and on a target
  // test rather than on "any event at all".
  //
  // It listened for `click` and closed unconditionally, which works exactly as long as every opener is a
  // RIGHT-click: a contextmenu press emits no click, so nothing arrived to close what had just opened. The
  // moment a plain button opened this menu (the session document's actions slot), the opening click itself
  // reached this listener and shut the menu in the same gesture — the button visibly toggled and no menu
  // ever appeared. Mousedown cannot do that: the press that opens is over before this effect binds.
  useEffect(() => {
    if (!menu) return undefined
    // A control that DECLARES it owns a menu keeps its own press, so pressing the opener again toggles
    // rather than closing here and reopening in the click that follows.
    const onDown = (event) => {
      if (event.target?.closest?.('.sess-menu, [aria-haspopup="menu"]')) return
      onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [menu, onClose])

  // Esc dismissal goes through the shared [[esc-layers]] stack so each surface this component floats above
  // the board peels in its own turn: the menu, then (after a pick) its rename or close-confirm modal — a
  // press closes the topmost one, never the session panel behind it (the old bespoke window listener raced it).
  useEscLayer(!!menu, onClose)
  useEscLayer(!!renaming, () => setRenaming(null))
  useEscLayer(!!closing, () => setClosing(null))
  useEscLayer(!!quarantining, () => setQuarantining(null))
  // attach's own Esc layer lives inside SessionAttach (it owns the modal); nothing to peel here.

  // select the prefilled name when the prompt opens, so a human can just type the replacement.
  useEffect(() => { if (renaming) requestAnimationFrame(() => inputRef.current?.select()) }, [renaming])

  // [[tab-strip]]'s explicit new tab, in the place a reader looks for it. The pointer gesture (ctrl/⌘-click)
  // is discoverable only if you already know it; a right-click is where a workspace is
  // asked what it can do with the thing under the cursor, which is why the review lists' row menu already
  // carries the same item. This menu opens from the finding dock, the Sessions page forest, and a session
  // tab's own right-click, so all three inherit the action from one place.
  const openInNewTab = (e) => {
    e.stopPropagation()
    const { id } = menu.session
    onClose()
    openNewTab('sessions', id)
  }

  const lockOnGraph = (e) => {
    e.stopPropagation()
    onLock?.(menu.session)
    onClose()
  }

  const startRename = (e) => {
    e.stopPropagation()
    setValue((menu.session.raw?.name ?? menu.session.name) || '')   // prefill the current OVERRIDE (blank if none) — the one legit raw consumer ([[session-label]]); never the derived label
    setRenaming(menu.session)
    onClose()
  }

  const startSelect = (e) => {
    e.stopPropagation()
    onMultiSelect?.(menu.session)
    onClose()
  }

  const detach = (e) => {
    e.stopPropagation()
    onDetach?.(menu.session)
    onClose()
  }

  // attach hands over the human escape-hatch command ([[attach-menu]]): swap the menu for a small modal that
  // shows (and copies) `spex session attach <id>`. Shown only when a live tmux window actually exists to join.
  const startAttach = (e) => {
    e.stopPropagation()
    setAttaching(menu.session)
    onClose()
  }

  // A cold row's only reverse action is the same resume endpoint used by the card. Filing is separately
  // confirmed below, alongside close in the menu's lifecycle danger group.
  const resume = (e) => {
    e.stopPropagation()
    const { id } = menu.session
    onClose()
    apiFetch(`/api/sessions/${id}/resume`, { method: 'POST' }).then(async (response) => {
      if (response.ok) return
      const body = await response.json().catch(() => null)
      onError?.(body?.error || `session resume refused (HTTP ${response.status})`)
    }).catch((error) => onError?.(error instanceof Error ? error.message : String(error))).finally(() => onChanged?.())
  }

  // close opens a confirm prompt first (the removal is destructive and a right-click is easy to mis-aim).
  const startClose = (e) => {
    e.stopPropagation()
    setClosing(menu.session)
    onClose()
  }

  const startQuarantine = (e) => {
    e.stopPropagation()
    const { id } = menu.session
    setWitness({ adapter: 'claude', thread: '', tmux: id, worktree: '', branch: '' })
    setQuarantining(menu.session)
    onClose()
  }

  const updateWitness = (key) => (e) => setWitness((current) => ({ ...current, [key]: e.target.value }))

  const confirmQuarantine = async (e) => {
    e.preventDefault()
    if (busy || !quarantining) return
    setBusy(true)
    try {
      const response = await apiFetch(`/api/sessions/${quarantining.id}/quarantine`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...witness, thread: witness.thread.trim() || null }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.ok === false) {
        onError?.(body?.error || `session quarantine refused (HTTP ${response.status})`)
        return
      }
      setQuarantining(null)
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      onChanged?.()
    }
  }

  // THE CLOSE CONFIRM HAS TWO OPENERS AND ONE BODY. The menu's own item is the first; a row dropped on
  // the dock's archive door is the second ([[dock-modes]]). The removal is identical, so the prompt is the
  // same prompt rather than a second one written beside it — two dialogs for one destruction is two places
  // for the wording, the danger styling and the background-removal semantics to drift apart. The drop's
  // request is owned by its caller, so dismissing has to hand it back rather than only clearing local state.
  const closingSession = closing || closeRequest
  const dismissClose = () => { setClosing(null); onCloseRequestDone?.() }

  // confirmed close: dismiss the confirm AT ONCE and fire the worktree removal in the BACKGROUND — it's
  // seconds of real work (git worktree remove + killing the agent/tmux), and (like New Session's launch)
  // the human must never watch a frozen, disabled dialog wait it out. The board reload when it lands drops
  // the row off every surface; the next poll reconciles a failure. No busy-guard: the prompt is already gone.
  const confirmClose = () => {
    const { id } = closingSession
    dismissClose()
    apiFetch(`/api/sessions/${id}/close`, { method: 'POST' })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok || body?.ok === false)
          onError?.(body?.error || `session close refused (HTTP ${response.status})`)
      })
      .catch((error) => onError?.(error instanceof Error ? error.message : String(error)))
      .finally(() => onChanged?.())
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const response = await apiFetch(`/api/sessions/${renaming.id}/rename`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: value }),
      })
      const body = await response.json().catch(() => null)
      // A successful route nudge is the graph-stream delivery authority. Reloading here races that same
      // change over HTTP and can hide a delayed delta; failure still asks the normal recovery path to reconcile.
      if (!response.ok || body?.ok === false) onChanged?.()
    } catch { /* the next board poll reconciles; nothing destructive to recover */ }
    finally { setBusy(false); setRenaming(null) }
  }

  return (
    <>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} anchorKey={menu.session.id} label={t('sessionWindow.menuLabel')}>
          <ContextMenuGroup>
            <ContextMenuItem icon="plus" onClick={openInNewTab}>{t('tabs.openInNewTab')}</ContextMenuItem>
            <ContextMenuItem icon="lock" onClick={lockOnGraph}>{t('sessionWindow.lock')}</ContextMenuItem>
            <ContextMenuItem icon="pencil" onClick={startRename}>{t('sessionWindow.rename')}</ContextMenuItem>
            <ContextMenuItem icon="list-checks" onClick={startSelect}>{t('sessionWindow.select')}</ContextMenuItem>
            {menu.session.parent && <ContextMenuItem icon="corner-up-left" onClick={detach}>{t('sessionWindow.detach')}</ContextMenuItem>}
            {/* attach only when a live tmux window exists to join — offline/queued rows have none. */}
            {menu.session.liveness !== 'offline' && menu.session.status !== 'queued' && (
              <ContextMenuItem icon="terminal" onClick={startAttach}>{t('sessionWindow.attach')}</ContextMenuItem>
            )}
            {/* Resume is the cold row's non-destructive exit; filing moves to the danger group below. */}
            {menu.session.archived && <ContextMenuItem icon="star-filled" onClick={resume}>{t('sessionWindow.resume')}</ContextMenuItem>}
            {menu.session.status === 'corrupt' && (
              <ContextMenuItem icon="archive" onClick={startQuarantine}>{t('sessionWindow.quarantine')}</ContextMenuItem>
            )}
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            <ContextMenuItem icon="trash" danger onClick={startClose}>{t('sessionWindow.close')}</ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenu>
      )}
      <SessionAttach session={attaching} socket={tmuxSocket} onClose={() => setAttaching(null)} />
      {/* rename + close modals below share the sess-rename chrome. */}
      {renaming && (
        <Modal
          title={t('sessionWindow.renameTitle', { name: sessionHeadline(renaming) })}
          closeLabel={t('common.close')}
          className="sess-rename-modal"
          onClose={() => setRenaming(null)}
        >
          <form className="sess-rename" onSubmit={submit}>
            <input
              ref={inputRef} className="sess-rename-input" value={value} autoFocus
              placeholder={t('sessionWindow.renamePlaceholder')}
              onChange={(e) => setValue(e.target.value)}
            />
            <div className="sess-rename-actions">
              <button type="button" className="sess-rename-btn" onClick={() => setRenaming(null)}>{t('common.cancel')}</button>
              <button type="submit" className="sess-rename-btn sess-rename-save" disabled={busy}>{t('common.save')}</button>
            </div>
          </form>
        </Modal>
      )}
      {closingSession && (
        <Modal
          title={t('sessionWindow.closeTitle', { name: sessionHeadline(closingSession) })}
          closeLabel={t('common.close')}
          className="sess-rename-modal"
          onClose={dismissClose}
        >
          <div className="sess-confirm">
            <p className="sess-confirm-msg">{t('sessionWindow.closeConfirm')}</p>
            <div className="sess-rename-actions">
              <button type="button" className="sess-rename-btn" onClick={dismissClose}>{t('common.cancel')}</button>
              <button type="button" className="sess-rename-btn danger" onClick={confirmClose} autoFocus>{t('sessionWindow.close')}</button>
            </div>
          </div>
        </Modal>
      )}
      {quarantining && (
        <Modal
          title={t('sessionWindow.quarantineTitle')}
          closeLabel={t('common.close')}
          className="sess-rename-modal"
          onClose={() => setQuarantining(null)}
        >
          <form className="sess-rename" onSubmit={confirmQuarantine}>
            <label><span>{t('sessionWindow.quarantineAdapter')}</span><input className="sess-rename-input" value={witness.adapter} onChange={updateWitness('adapter')} autoFocus /></label>
            <label><span>{t('sessionWindow.quarantineThread')}</span><input className="sess-rename-input" value={witness.thread} onChange={updateWitness('thread')} /></label>
            <label><span>{t('sessionWindow.quarantineTmux')}</span><input className="sess-rename-input" value={witness.tmux} onChange={updateWitness('tmux')} /></label>
            <label><span>{t('sessionWindow.quarantineWorktree')}</span><input className="sess-rename-input" value={witness.worktree} onChange={updateWitness('worktree')} /></label>
            <label><span>{t('sessionWindow.quarantineBranch')}</span><input className="sess-rename-input" value={witness.branch} onChange={updateWitness('branch')} /></label>
            <div className="sess-rename-actions">
              <button type="button" className="sess-rename-btn" onClick={() => setQuarantining(null)}>{t('common.cancel')}</button>
              <button type="submit" className="sess-rename-btn" disabled={busy}>{t('sessionWindow.quarantineConfirm')}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
