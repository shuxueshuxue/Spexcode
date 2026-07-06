import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// The app's ONE tooltip ([[tooltip]]): a singleton bubble driven by document-level delegation.
// Any element carrying `data-tip` gets it — hover arms a ~400ms timer (instant while a tip is
// already warm), keyboard :focus-visible shows immediately, Esc/scroll/press dismiss. The bubble
// portals to <body>, positions above the anchor and flips below when the viewport clips it, and
// styles entirely through the palette CSS vars so both themes come for free (styles.css .ui-tip).
// While shown it stamps aria-describedby on the anchor so the copy is exposed, not hover-only.

const SHOW_DELAY = 400   // cold hover → visible
const WARM_DELAY = 80    // a tip is already up: moving to a sibling control swaps fast
const GAP = 7            // anchor edge → bubble edge (the arrow lives inside it)
const PAD = 6            // minimum clearance from the viewport edge

export default function TooltipLayer() {
  const [tip, setTip] = useState(null)            // { text, anchor }
  const bubbleRef = useRef(null)
  const timer = useRef(0)
  const current = useRef(null)                    // the anchor a show is armed or visible for
  const describedRef = useRef(null)               // anchor we stamped aria-describedby on
  const warm = useRef(false)

  useEffect(() => {
    const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = 0 } }
    const hide = () => {
      clearTimer()
      current.current = null
      if (describedRef.current) {
        if (describedRef.current.getAttribute('aria-describedby') === 'ui-tip') describedRef.current.removeAttribute('aria-describedby')
        describedRef.current = null
      }
      setTip((t) => {
        if (t) { warm.current = true; setTimeout(() => { if (!current.current) warm.current = false }, 300) }
        return null
      })
    }
    const show = (anchor) => {
      const text = anchor.getAttribute('data-tip')
      if (!text || !anchor.isConnected) return
      current.current = anchor
      if (!anchor.getAttribute('aria-describedby')) { anchor.setAttribute('aria-describedby', 'ui-tip'); describedRef.current = anchor }
      setTip({ text, anchor })
    }
    const arm = (anchor, delay) => {
      if (current.current === anchor) return
      clearTimer()
      current.current = anchor
      timer.current = setTimeout(() => { timer.current = 0; show(anchor) }, delay)
    }
    const over = (e) => {
      const anchor = e.target.closest?.('[data-tip]')
      if (!anchor) return
      arm(anchor, warm.current ? WARM_DELAY : SHOW_DELAY)
    }
    const out = (e) => {
      const anchor = e.target.closest?.('[data-tip]')
      if (!anchor || anchor !== current.current) return
      if (anchor.contains(e.relatedTarget)) return
      hide()
    }
    // keyboard reach: focus-visible shows the tip immediately; a mouse click's focus stays quiet.
    const focusin = (e) => {
      const anchor = e.target.closest?.('[data-tip]')
      if (!anchor) return
      let kb = true
      try { kb = anchor.matches(':focus-visible') } catch { /* older engines: show on any focus */ }
      if (kb) { clearTimer(); show(anchor) }
    }
    const focusout = (e) => {
      const anchor = e.target.closest?.('[data-tip]')
      if (anchor && anchor === current.current) hide()
    }
    const key = (e) => { if (e.key === 'Escape') hide() }
    // pointerover/out (not mouseover) so disabled buttons — which swallow mouse events — still tip.
    document.addEventListener('pointerover', over, true)
    document.addEventListener('pointerout', out, true)
    document.addEventListener('focusin', focusin, true)
    document.addEventListener('focusout', focusout, true)
    document.addEventListener('keydown', key, true)
    document.addEventListener('pointerdown', hide, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      clearTimer()
      document.removeEventListener('pointerover', over, true)
      document.removeEventListener('pointerout', out, true)
      document.removeEventListener('focusin', focusin, true)
      document.removeEventListener('focusout', focusout, true)
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [])

  // place after paint: above the anchor by default, flip below when the top would clip; clamp
  // horizontally and keep the arrow pointing at the anchor's centre.
  useEffect(() => {
    const el = bubbleRef.current
    if (!tip || !el) return
    if (!tip.anchor.isConnected) { setTip(null); return }
    const a = tip.anchor.getBoundingClientRect()
    const b = el.getBoundingClientRect()
    const place = a.top - b.height - GAP >= PAD ? 'top' : 'bottom'
    const top = place === 'top' ? a.top - b.height - GAP : a.bottom + GAP
    const left = Math.min(Math.max(a.left + a.width / 2 - b.width / 2, PAD), window.innerWidth - b.width - PAD)
    el.dataset.place = place
    el.style.top = `${Math.round(top)}px`
    el.style.left = `${Math.round(left)}px`
    const arrow = el.querySelector('.ui-tip-arrow')
    if (arrow) arrow.style.left = `${Math.round(Math.min(Math.max(a.left + a.width / 2 - left, 10), b.width - 10)) - 4}px`
    const raf = requestAnimationFrame(() => el.classList.add('show'))
    return () => cancelAnimationFrame(raf)
  }, [tip])

  if (!tip) return null
  return createPortal(
    <div id="ui-tip" role="tooltip" ref={bubbleRef} className="ui-tip">
      {tip.text}
      <span className="ui-tip-arrow" aria-hidden="true" />
    </div>,
    document.body,
  )
}
