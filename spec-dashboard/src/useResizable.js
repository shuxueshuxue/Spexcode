import { useCallback, useRef, useState } from 'react'

// Drag-to-resize for a fixed-size pane ([[resizable-panes]]): returns the pane's size and the mousedown
// handler its divider mounts. One hook for every resizable pane — the session board's list, a held region —
// so they all clamp, persist (localStorage, per pane key), and drag the same way.
// `dir: 1` = pane sits BEFORE its divider (dragging away from it grows the pane); `dir: -1` = pane sits after.
// `axis: 'y'` measures the drag vertically, for a pane stacked under its divider rather than beside it: one
// mechanism for both seams, because a divider that can be moved is one idea, not two.
export function useResizable(key, initial, { min, max, dir = 1, axis = 'x' } = {}) {
  const [width, setWidth] = useState(() => {
    try {
      const saved = parseInt(localStorage.getItem(key), 10)
      if (Number.isFinite(saved)) return Math.max(min, Math.min(max, saved))
    } catch {}
    return initial
  })
  const drag = useRef(null)

  const onDragStart = useCallback((e) => {
    e.preventDefault()
    drag.current = { at: axis === 'y' ? e.clientY : e.clientX, w: width }
    const onMove = (ev) => {
      const d = drag.current
      if (!d) return
      const at = axis === 'y' ? ev.clientY : ev.clientX
      const w = Math.max(min, Math.min(max, d.w + (at - d.at) * dir))
      setWidth(w)
    }
    const onUp = () => {
      drag.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.classList.remove('is-resizing')
      // persist on release, not per-move — one write per gesture.
      setWidth((w) => { try { localStorage.setItem(key, String(Math.round(w))) } catch {}; return w })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    // suppress text selection + keep the col-resize cursor for the whole gesture, wherever the mouse is.
    document.body.classList.add('is-resizing')
  }, [key, width, min, max, dir, axis])

  const reset = useCallback(() => {
    setWidth(initial)
    try { localStorage.removeItem(key) } catch {}
  }, [initial, key])

  return [width, onDragStart, reset]
}
