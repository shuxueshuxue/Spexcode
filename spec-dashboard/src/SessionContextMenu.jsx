// @@@ SessionContextMenu - the right-click menu on a session row, plus its rename flow. Right-clicking a
// row opens this small menu anchored at the cursor; "Rename" swaps it for a centred prompt (the shared
// Modal) prefilled with the session's CURRENT name override. Submitting POSTs the new name to
// /api/sessions/:id/rename — the backend persists it to the worktree's `.session` as the `name` override
// that wins over the derived label — then asks the board to reload so the new name shows on every surface
// at once. A blank name CLEARS the override, reverting the row to its derived label (node/title/branch/id).
// The menu is its own pop-over (not a board node), so the window stays a thin glance and this owns the gesture.

import { useEffect, useRef, useState } from 'react'
import Modal from './Modal.jsx'
import { apiFetch } from './data.js'
import { sessionName } from './session.js'
import { useT } from './i18n/index.jsx'

export default function SessionContextMenu({ menu, onClose, onRenamed }) {
  const t = useT()
  const [renaming, setRenaming] = useState(null)   // the session whose rename prompt is open | null
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

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await apiFetch(`/api/sessions/${renaming.id}/rename`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: value }),
      })
      onRenamed?.()
    } catch { /* the next board poll reconciles; nothing destructive to recover */ }
    finally { setBusy(false); setRenaming(null) }
  }

  return (
    <>
      {menu && (
        <div className="sess-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button className="sess-menu-item" onClick={startRename}>{t('sessionWindow.rename')}</button>
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
    </>
  )
}
