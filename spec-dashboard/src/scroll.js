// ease scrollTop toward an accumulating target that survives across keydowns, so held/repeated keys stack
// into one glide instead of restarting a `behavior:'smooth'` tween each press (which stuttered on key-repeat).
export function createMomentumScroll() {
  let animId = 0
  let target = null
  let lastEl = null
  let lastWritten = null                                 // the scrollTop value the loop itself last wrote
  return function bump(el, delta) {
    if (!el) return
    if (el !== lastEl) { lastEl = el; target = null }   // new scroller → drop the stale accumulated target
    const max = el.scrollHeight - el.clientHeight
    const base = target ?? el.scrollTop
    target = Math.max(0, Math.min(max, base + delta))
    cancelAnimationFrame(animId)
    const step = () => {
      // a manual scroll (wheel/trackpad/drag) mid-glide moves scrollTop off what we last wrote → the user
      // wins: cancel, drop the stale target, keep their position. No event listeners to manage.
      if (lastWritten != null && Math.abs(el.scrollTop - lastWritten) > 1) {
        cancelAnimationFrame(animId)
        target = null
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
