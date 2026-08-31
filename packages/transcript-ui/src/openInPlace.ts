import { useCallback, useLayoutEffect, useRef, type MutableRefObject } from 'react'

// WHAT YOU OPEN STAYS WHERE IT WAS. Growing a block inside a scroller moves everything below it down, and
// the browser's own scroll anchoring then picks some element to hold still — often one BELOW the growth, so
// the scroller slides by exactly the height that appeared and the reader is carried away from the very thing
// they pressed. CSS cannot nominate the anchor, so the block nominates itself: its top edge is measured
// before the open and restored after, which is the behaviour a reader expects from a disclosure.
const scrollParent = (node: HTMLElement | null): HTMLElement | null => {
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight) return el
  }
  return null
}

/**
 * Keeps the referenced element's viewport position across an open. Call `mark()` in the handler that opens,
 * and pass the open state so the correction runs in the same frame the growth lands in.
 */
export function useOpenInPlace<T extends HTMLElement>(isOpen: boolean): { ref: MutableRefObject<T | null>; mark: () => void } {
  const ref = useRef<T | null>(null)
  const topRef = useRef<number | null>(null)
  const mark = useCallback(() => {
    topRef.current = ref.current ? ref.current.getBoundingClientRect().top : null
  }, [])
  useLayoutEffect(() => {
    const before = topRef.current
    const el = ref.current
    topRef.current = null
    if (before === null || !el) return
    const scroller = scrollParent(el)
    if (!scroller) return
    // reading the rect here forces the layout in which anchoring has already had its say, so this correction
    // is measured against what the reader would actually have seen
    const drift = el.getBoundingClientRect().top - before
    if (drift) scroller.scrollTop += drift
  }, [isOpen])
  return { ref, mark }
}
