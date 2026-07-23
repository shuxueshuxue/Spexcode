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
//    else focuses the element marked `data-focus-sink` (the current surface's authored textarea or xterm
//    helper textarea). Never <body>.

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
// fighting it. If a successor overlay already holds focus by then, it owns it — no yanking.
export function returnFocus() {
  requestAnimationFrame(() => {
    if (inOverlay(document.activeElement)) return
    if (focusableNow(ticket)) { ticket.focus(); return }
    const sink = document.querySelector('[data-focus-sink]')
    if (focusableNow(sink)) sink.focus()
  })
}

// The acquisition-side twin of returnFocus: INERT CHROME NEVER TAKES FOCUS, so there is nothing to give
// back. Attached as a capture-phase mousedown handler on a surface whose focus rests on its sink (the
// session console's panel, a context menu): a press on anything that is not itself an input surface is
// stopped from moving focus — the click still lands and acts, the press just stops stealing. Editable
// fields and the xterm screen keep their native press-to-focus; a press in a scroller's scrollbar gutter
// keeps its default too (cancelling it breaks thumb dragging, and gutter presses never move focus anyway).
const FOCUS_OWNERS = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], .xterm'

// scrollbar presses only ever target the scrollable HTMLElement itself — an SVG target (an icon
// glyph on a button) reports clientWidth/Height 0 and would false-positive as a gutter press.
const inScrollbarGutter = (el, e) => {
  if (!(el instanceof HTMLElement)) return false
  const rect = el.getBoundingClientRect()
  return e.clientX - rect.left - el.clientLeft >= el.clientWidth
    || e.clientY - rect.top - el.clientTop >= el.clientHeight
}

export function inertChromePress(e) {
  const el = e.target
  if (!(el instanceof Element)) return
  if (el.closest(FOCUS_OWNERS)) return
  if (inScrollbarGutter(el, e)) return
  e.preventDefault()
}
