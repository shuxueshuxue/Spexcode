// ease scrollTop toward an accumulating target that survives across keydowns, so held/repeated keys stack
// into one glide instead of restarting a `behavior:'smooth'` tween each press (which stuttered on key-repeat).
export function createMomentumScroll() {
  let animId = 0
  let target = null
  let lastEl = null
  let lastWritten = null                                 // the scrollTop value the loop itself last wrote
  return function bump(el, delta) {
    if (!el) return
    // The accumulated target is only valid while the scroller still sits where the loop last left it.
    // A different element, or a scrollTop that moved off `lastWritten` (the user wheeled/dragged since),
    // means the target is stale → start fresh from where the user actually is. This makes a manual scroll
    // win whether it lands BETWEEN key presses (here) or mid-glide (the step check below) — same rule.
    const moved = lastWritten != null && Math.abs(el.scrollTop - lastWritten) > 1
    if (el !== lastEl || moved) { lastEl = el; target = null; lastWritten = null }
    const max = el.scrollHeight - el.clientHeight
    const base = target ?? el.scrollTop
    target = Math.max(0, Math.min(max, base + delta))
    cancelAnimationFrame(animId)
    const step = () => {
      // a manual scroll (wheel/trackpad/drag) mid-glide moves scrollTop off what we last wrote → the user
      // wins: cancel, drop the stale target + baseline, keep their position. No event listeners to manage.
      if (lastWritten != null && Math.abs(el.scrollTop - lastWritten) > 1) {
        cancelAnimationFrame(animId)
        target = null
        lastWritten = null
        return
      }
      const d = target - el.scrollTop
      if (Math.abs(d) < 0.5) { el.scrollTop = target; lastWritten = el.scrollTop; return }
      el.scrollTop += d * 0.2                            // fixed fraction per frame = exponential glide
      lastWritten = el.scrollTop                         // read back the (possibly rounded) value we set
      animId = requestAnimationFrame(step)
    }
    animId = requestAnimationFrame(step)
  }
}
