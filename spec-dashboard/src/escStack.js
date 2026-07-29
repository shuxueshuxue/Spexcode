
import { useEffect, useRef } from 'react'

// Vite HMR keeps the existing listener, so the stack lives on window for re-evaluated modules to share.
const stack = typeof window !== 'undefined' ? (window.__escStack || (window.__escStack = [])) : []

if (typeof window !== 'undefined' && !window.__escStackBound) {
  window.__escStackBound = true
  window.addEventListener('keydown', (e) => {
    const s = window.__escStack
    if (e.key !== 'Escape' || !s || s.length === 0) return
    e.preventDefault()
    e.stopImmediatePropagation()   // the layer below (a panel, the board) must NOT also close on this press
    s[s.length - 1].close()
  }, true)
}

// useEscLayer - register `onClose` as the top Esc layer while `active`. `onClose` is read through a ref so
// the layer's identity is stable across renders (deps = [active] only) — the stack order never churns just
// because a parent re-rendered with a fresh inline closure. Pops on unmount or when `active` goes false.
export function useEscLayer(active, onClose) {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    if (!active) return undefined
    const layer = { close: () => ref.current?.() }
    stack.push(layer)
    return () => {
      const i = stack.indexOf(layer)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}
