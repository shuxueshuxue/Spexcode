import { useEffect, useRef, useState } from 'react'
import { ContextMenu, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator } from './ContextMenu.jsx'
import Modal from './Modal.jsx'
import SessionAttach from './SessionAttach.jsx'
import { apiFetch, loadSettings } from './data.js'
import { sessionHeadline } from './session.js'
import { useEscLayer } from './escStack.js'
import { useT } from './i18n/index.jsx'

export default function SessionContextMenu({ menu, onClose, onChanged, onLock, onMultiSelect }) {
  const t = useT()
  const [renaming, setRenaming] = useState(null)   // the session whose rename prompt is open | null
  const [closing, setClosing] = useState(null)     // the session whose close-confirm prompt is open | null
  const [attaching, setAttaching] = useState(null) // the session whose attach modal is open | null ([[attach-menu]])
  const [tmuxSocket, setTmuxSocket] = useState('spexcode') // the private tmux server's -L label; the default until settings load
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  // the tmux socket is a backend fact (env-overridable), fetched once so the raw-tmux attach fallback names the
  // RIGHT server; the built-in default stands in until it lands and is harmless if the fetch never returns.
  useEffect(() => { loadSettings().then((s) => { if (s?.tmuxSocket) setTmuxSocket(s.tmuxSocket) }).catch(() => { /* keep the default */ }) }, [])

  // standard context-menu dismissal: any click outside closes the popped menu. The menu div stops its own
  // clicks (below) so picking an item never trips this. Bound only while it's open.
  useEffect(() => {
    if (!menu) return
    window.addEventListener('click', onClose)
    return () => window.removeEventListener('click', onClose)
  }, [menu, onClose])

  // Esc dismissal goes through the shared [[esc-layers]] stack so each surface this component floats above
  // the board peels in its own turn: the menu, then (after a pick) its rename or close-confirm modal — a
  // press closes the topmost one, never the session panel behind it (the old bespoke window listener raced it).
  useEscLayer(!!menu, onClose)
  useEscLayer(!!renaming, () => setRenaming(null))
  useEscLayer(!!closing, () => setClosing(null))
  // attach's own Esc layer lives inside SessionAttach (it owns the modal); nothing to peel here.

  // select the prefilled name when the prompt opens, so a human can just type the replacement.
  useEffect(() => { if (renaming) requestAnimationFrame(() => inputRef.current?.select()) }, [renaming])

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

  // select flips the whole list into multi-select mode ([[session-multi-select]]), pre-ticking the row that
  // was right-clicked. The mode itself lives in the list; the menu item only turns it on and dismisses.
  const startSelect = (e) => {
    e.stopPropagation()
    onMultiSelect?.(menu.session)
    onClose()
  }

  // attach hands over the human escape-hatch command ([[attach-menu]]): swap the menu for a small modal that
  // shows (and copies) `spex session attach <id>`. Shown only when a live tmux window actually exists to join.
  const startAttach = (e) => {
    e.stopPropagation()
    setAttaching(menu.session)
    onClose()
  }

  // close opens a confirm prompt first (the removal is destructive and a right-click is easy to mis-aim).
  const startClose = (e) => {
    e.stopPropagation()
    setClosing(menu.session)
    onClose()
  }

  // confirmed close: dismiss the confirm AT ONCE and fire the worktree removal in the BACKGROUND — it's
  // seconds of real work (git worktree remove + killing the agent/tmux), and (like New Session's launch)
  // the human must never watch a frozen, disabled dialog wait it out. The board reload when it lands drops
  // the row off every surface; the next poll reconciles a failure. No busy-guard: the prompt is already gone.
  const confirmClose = () => {
    const { id } = closing
    setClosing(null)
    apiFetch(`/api/sessions/${id}/close`, { method: 'POST' })
      .catch(() => { /* the next board poll reconciles */ })
      .finally(() => onChanged?.())
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await apiFetch(`/api/sessions/${renaming.id}/rename`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: value }),
      })
      onChanged?.()
    } catch { /* the next board poll reconciles; nothing destructive to recover */ }
    finally { setBusy(false); setRenaming(null) }
  }

  return (
    <>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} anchorKey={menu.session.id} label={t('sessionWindow.menuLabel')}>
          <ContextMenuGroup>
            <ContextMenuItem icon="lock" onClick={lockOnGraph}>{t('sessionWindow.lock')}</ContextMenuItem>
            <ContextMenuItem icon="pencil" onClick={startRename}>{t('sessionWindow.rename')}</ContextMenuItem>
            {/* attach only when a live tmux window exists to join — offline/queued rows have none. */}
            {menu.session.liveness !== 'offline' && menu.session.status !== 'queued' && (
              <ContextMenuItem icon="terminal" onClick={startAttach}>{t('sessionWindow.attach')}</ContextMenuItem>
            )}
            <ContextMenuItem icon="list-checks" onClick={startSelect}>{t('sessionWindow.select')}</ContextMenuItem>
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
      {closing && (
        <Modal
          title={t('sessionWindow.closeTitle', { name: sessionHeadline(closing) })}
          closeLabel={t('common.close')}
          className="sess-rename-modal"
          onClose={() => setClosing(null)}
        >
          <div className="sess-confirm">
            <p className="sess-confirm-msg">{t('sessionWindow.closeConfirm')}</p>
            <div className="sess-rename-actions">
              <button type="button" className="sess-rename-btn" onClick={() => setClosing(null)}>{t('common.cancel')}</button>
              <button type="button" className="sess-rename-btn danger" onClick={confirmClose}>{t('sessionWindow.close')}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
