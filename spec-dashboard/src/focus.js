// focus.js — the board's focus-return boundary and default sink.
//
// The contract (see the `focus-return` node): focus is never left resting on <body>. A transient overlay
// (the search palette, the help/settings modals, the node popup) TAKES focus when it opens and must RETURN
// it when it closes — to whoever held it before, else to the surface's declared default sink. This is the
// twin of the keyboard contract: a modal owns the keys ([[keyboard-nav]]) AND returns the focus.
//
// The mechanism is fully decoupled, so an overlay need not know the sink and the sink need not know the
// overlays:
//  - a module-level `focusin` listener remembers the last element focused OUTSIDE any overlay — the
//    "return ticket". An overlay marks its root `data-focus-overlay`, so focus landing inside it is never
//    recorded as the ticket.
//  - returnFocus(), called when the last overlay closes, restores the ticket if it is still focusable,
//    else focuses the element marked `data-focus-sink` (the always-focused input — the session board's
//    docked box). Never <body>.

let ticket = null

const inOverlay = (el) => !!(el && el.closest && el.closest('[data-focus-overlay]'))
// "focusable right now": still in the DOM, enabled, and actually rendered (getClientRects covers fixed
// elements that offsetParent reports as hidden).
const focusableNow = (el) => !!(el && el.isConnected && !el.disabled && el.getClientRects().length)

if (typeof window !== 'undefined') {
  window.addEventListener('focusin', (e) => {
    const el = e.target
    if (el && el !== document.body && !inOverlay(el)) ticket = el
  }, true)
}

// Return focus after a transient overlay closes: the prior holder if it survives, else the sink. Deferred
// a frame so it runs after the overlay has unmounted and any sibling focus effect has had its say — the
// `focusin` tracker keeps the ticket current, so this converges on the latest stable focus rather than
// fighting it.
export function returnFocus() {
  requestAnimationFrame(() => {
    if (focusableNow(ticket)) { ticket.focus(); return }
    const sink = document.querySelector('[data-focus-sink]')
    if (focusableNow(sink)) sink.focus()
  })
}
