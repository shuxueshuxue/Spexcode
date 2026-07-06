// @@@ escStack - the dashboard's ONE Escape contract for overlays that float as their OWN component ABOVE
// another surface: the proof iframe, a session row's rename / close-confirm modals, the row context-menu.
// Each pushes itself onto a LIFO stack while open. A SINGLE capture-phase window listener — bound at module
// load, so it is the FIRST keydown listener and beats every component's own — pops the TOPMOST layer on Esc
// and swallows the event (stopImmediatePropagation) so the surface BEHIND never also closes. Esc therefore
// peels exactly one layer per press, in reverse open order (the confirm peels while the panel stays; the
// proof peels while the panel stays). When the stack is empty it does nothing, so the board's own
// single-handler Esc — a locked-session release, the help/settings modals, the panel's menu / nav-mode — is
// untouched (and a page-level Esc with nothing open routes nowhere — pages are peers, not layers). This owns only the cross-component overlay layers: the ones that used to RACE the panel's
// always-on window listener (whoever registered first won; proof papered over it by stealing iframe focus).
import { useEffect, useRef } from 'react'

// The stack and the bound-flag live on `window`, NOT in module scope, so a Vite HMR hot-swap — which
// re-evaluates this module (a fresh array) WITHOUT a page reload — reuses the one array the already-bound
// listener reads. Module scope would split them: an open tab that hot-swapped across a deploy would leave
// the live listener watching the dead old array while useEscLayer pushed to the new one, so Esc would fall
// through and close the surface BEHIND the top overlay too. Reading the global inside the listener keeps a
// single source of truth across any number of re-evals.
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
