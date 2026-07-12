import { useCallback, useRef, useState } from 'react'

// Drag-to-resize for a fixed-width pane ([[resizable-panes]]): returns the pane's width and the mousedown
// handler its divider mounts. One hook for every resizable pane — the session board's list, the graph's
// focus panel — so they all clamp, persist (localStorage, per pane key), and drag the same way.
// `dir: 1` = pane sits LEFT of its divider (dragging right widens); `dir: -1` = pane sits right.
export function useResizable(key, initial, { min, max, dir = 1 } = {}) {
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
    drag.current = { x: e.clientX, w: width }
    const onMove = (ev) => {
      const d = drag.current
      if (!d) return
      const w = Math.max(min, Math.min(max, d.w + (ev.clientX - d.x) * dir))
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
  }, [key, width, min, max, dir])

  return [width, onDragStart]
}
