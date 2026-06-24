// @@@ SessionContextMenu - the right-click menu on a session row, with two gestures. "Rename" swaps the
// menu for a centred prompt (the shared Modal) prefilled with the session's CURRENT name override;
// submitting POSTs to /api/sessions/:id/rename — the backend persists it to the worktree's `.session` as the
// `name` override that wins over the derived label — and a blank name CLEARS the override. "Close" POSTs
// /api/sessions/:id/close (the human-only worktree removal) — this menu is now the ONLY close path (the header
// once had a button, but its "close" label misread as "close the panel"). It sits behind a **confirm prompt**,
// because a right-click is easy to mis-aim and the removal is destructive. Either gesture calls onChanged so
// the board reloads and every surface reflects it at once.
// The menu is its own pop-over (not a board node), so the window stays a thin glance and this owns the gesture.

import { useEffect, useRef, useState } from 'react'
import Modal from './Modal.jsx'
import { apiFetch, setSessionSort } from './data.js'
import { sessionName } from './session.js'
import { useT } from './i18n/index.jsx'

export default function SessionContextMenu({ menu, onClose, onChanged }) {
  const t = useT()
  const [renaming, setRenaming] = useState(null)   // the session whose rename prompt is open | null
  const [closing, setClosing] = useState(null)     // the session whose close-confirm prompt is open | null
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  // standard context-menu dismissal: any click outside, Escape, or a scroll closes the popped menu. The
  // menu div stops its own clicks (below) so picking an item never trips this. Bound only while it's open.
  useEffect(() => {
    if (!menu) return
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('click', onClose)
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('click', onClose); window.removeEventListener('keydown', onKey, true) }
  }, [menu, onClose])

  // select the prefilled name when the prompt opens, so a human can just type the replacement.
  useEffect(() => { if (renaming) requestAnimationFrame(() => inputRef.current?.select()) }, [renaming])

  const startRename = (e) => {
    e.stopPropagation()
    setValue(menu.session.name || '')   // prefill the current OVERRIDE (blank if none) — not the derived label
    setRenaming(menu.session)
    onClose()
  }

  // @@@ reset order ([[session-reorder]]) - clear this row's drag-reorder pseudo-time, dropping it back to its
  // birth slot (the reset twin of a blank rename). No confirm — it's non-destructive — and no prompt: one POST
  // then reload. Only offered when the row actually has a `sortKey` to clear (see the conditional below).
  const resetOrder = async (e) => {
    e.stopPropagation()
    const id = menu.session.id
    onClose()
    try { await setSessionSort(id, null) } catch { /* the next board poll reconciles */ }
    onChanged?.()
  }

  // close opens a confirm prompt first (the removal is destructive and a right-click is easy to mis-aim).
  const startClose = (e) => {
    e.stopPropagation()
    setClosing(menu.session)
    onClose()
  }

  // confirmed close: POST the human-only worktree removal, then reload so the row drops off every surface.
  const confirmClose = async () => {
    if (busy) return
    setBusy(true)
    try { await apiFetch(`/api/sessions/${closing.id}/close`, { method: 'POST' }) }
    catch { /* the next board poll reconciles */ }
    finally { setBusy(false); setClosing(null); onChanged?.() }
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
        <div className="sess-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button className="sess-menu-item" onClick={startRename}>{t('sessionWindow.rename')}</button>
          {menu.session.sortKey != null && (
            <button className="sess-menu-item" onClick={resetOrder}>{t('sessionWindow.resetOrder')}</button>
          )}
          <button className="sess-menu-item danger" onClick={startClose}>{t('sessionWindow.close')}</button>
        </div>
      )}
      {renaming && (
        <Modal
          title={t('sessionWindow.renameTitle', { name: sessionName(renaming) })}
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
          title={t('sessionWindow.closeTitle', { name: sessionName(closing) })}
          closeLabel={t('common.close')}
          className="sess-rename-modal"
          onClose={() => setClosing(null)}
        >
          <div className="sess-confirm">
            <p className="sess-confirm-msg">{t('sessionWindow.closeConfirm')}</p>
            <div className="sess-rename-actions">
              <button type="button" className="sess-rename-btn" onClick={() => setClosing(null)}>{t('common.cancel')}</button>
              <button type="button" className="sess-rename-btn danger" onClick={confirmClose} disabled={busy}>{t('sessionWindow.close')}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
