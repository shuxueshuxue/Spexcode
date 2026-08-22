// [[drag-gesture]]: the pointer gesture every movable list in this window shares.
//
// Moving something with the pointer is not one behaviour, it is a small pile of them, and each one has a
// way of being got subtly wrong on its own: a press that was meant as a click must stay a click, the click
// the browser emits after a real drag must not fire the row's own action, the listeners have to be on the
// WINDOW (a pointer leaves the row it started on immediately, which is the whole point) and they have to
// come off again on unmount, Escape has to abandon the move without applying it. Written per list, those
// five drift apart; the tab strip and the session dock would then disagree about how hard you have to pull
// before a click becomes a drag, which is exactly the kind of difference a reader feels and cannot name.
//
// It is deliberately NOT native HTML5 drag-and-drop. That API brings a drop-target protocol, a transfer
// payload and a browser-drawn ghost — none of which either caller wants — and its `dragstart` is swallowed
// by the interactive elements both lists are built from (a row IS a button here). Mouse events on the
// window are the smaller mechanism, and they are what the retired session list proved out.

// SIX PIXELS OF SLACK before a press becomes a move. It is the number the old session list used and the
// number this replaces it with: small enough that a deliberate drag feels immediate, large enough that a
// click delivered by a hand that moved a pixel is still a click.
export const DRAG_THRESHOLD = 6

// The body wears the gesture, so a cursor and a text-selection ban apply to the whole window rather than
// to the list that happens to own the pointer.
const DRAGGING_CLASS = 'is-dragging'

// A DRAG EATS ITS OWN CLICK. A moved button still dispatches `click` on release, and that click would run
// whatever the row does when clicked — navigating away from the thing just dropped. The swallow is one
// capturing listener that lives for a single turn: browsers that suppress the click themselves simply
// never hand it one, and the row's ordinary clicks are untouched from the next turn onward.
function swallowNextClick() {
  const swallow = (event) => { event.stopPropagation(); event.preventDefault() }
  window.addEventListener('click', swallow, true)
  window.setTimeout(() => window.removeEventListener('click', swallow, true), 0)
}

// The element under a point that matches `selector`, or null. Both callers ask this question — "what am I
// over right now" — and neither can answer it from the event target, because the pointer is captured by
// the window while a drag is live.
export function elementAt(x, y, selector) {
  return document.elementFromPoint(x, y)?.closest?.(selector) || null
}

// Track a press as a possible move. Returns a `stop()` that abandons the gesture — call it from an unmount
// effect so a component that disappears mid-drag leaves nothing behind on the window.
//
//   onStart(point)  the threshold was crossed; the move is real from here
//   onMove(point)   the pointer moved while the move is real
//   onDrop(point)   released after a real move — apply it
//   onCancel()      Escape, or an unmount; the move is abandoned and nothing is applied
//
// Below the threshold nothing is called at all, and the press stays an ordinary click.
export function startDrag(event, { threshold = DRAG_THRESHOLD, onStart, onMove, onDrop, onCancel } = {}) {
  if (event.button !== 0) return () => {}
  const origin = { x: event.clientX, y: event.clientY }
  let live = false

  const detach = () => {
    window.removeEventListener('mousemove', onPointerMove, true)
    window.removeEventListener('mouseup', onPointerUp, true)
    window.removeEventListener('keydown', onKey, true)
    if (live) document.body.classList.remove(DRAGGING_CLASS)
  }
  const abandon = () => { const wasLive = live; detach(); live = false; if (wasLive) { swallowNextClick(); onCancel?.() } }

  function onPointerMove(move) {
    const point = { x: move.clientX, y: move.clientY }
    if (!live) {
      if (Math.hypot(point.x - origin.x, point.y - origin.y) < threshold) return
      live = true
      document.body.classList.add(DRAGGING_CLASS)
      onStart?.(point)
    }
    onMove?.(point)
  }
  function onPointerUp(up) {
    const wasLive = live
    detach()
    live = false
    if (!wasLive) return
    swallowNextClick()
    onDrop?.({ x: up.clientX, y: up.clientY })
  }
  function onKey(key) { if (key.key === 'Escape') abandon() }

  window.addEventListener('mousemove', onPointerMove, true)
  window.addEventListener('mouseup', onPointerUp, true)
  window.addEventListener('keydown', onKey, true)
  return abandon
}
