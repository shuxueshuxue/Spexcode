// ease scrollTop toward an accumulating target that survives across keydowns, so held/repeated keys stack
// into one glide instead of restarting a `behavior:'smooth'` tween each press (which stuttered on key-repeat).
export function createMomentumScroll() {
  let animId = 0
  let target = null
  let lastEl = null
  return function bump(el, delta) {
    if (!el) return
    if (el !== lastEl) { lastEl = el; target = null }   // new scroller → drop the stale accumulated target
    const max = el.scrollHeight - el.clientHeight
    const base = target ?? el.scrollTop
    target = Math.max(0, Math.min(max, base + delta))
    cancelAnimationFrame(animId)
    const step = () => {
      const d = target - el.scrollTop
      if (Math.abs(d) < 0.5) { el.scrollTop = target; return }
      el.scrollTop += d * 0.2                            // fixed fraction per frame = exponential glide
      animId = requestAnimationFrame(step)
    }
    animId = requestAnimationFrame(step)
  }
}
