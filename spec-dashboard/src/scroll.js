// @@@ momentum scroll - the j/k keyboard-scroll shared by every scrollable modal (the node-info popup's
// open pane and the help/legend body). A keypress eases the element's scrollTop toward an ACCUMULATING
// target that survives across keydowns, so held / repeated keys stack into one continuous glide instead
// of restarting a fresh `behavior:'smooth'` tween each press (which stuttered on key-repeat).
//
// `createMomentumScroll()` returns a `bump(el, delta)` closure that owns its own animation + target
// state. Each modal keeps one instance (so its glide is independent). The target resets whenever the
// element changes (e.g. switching popup panes swaps the scroller), so a stale offset never carries over.
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
