import { useLayoutEffect, useRef } from 'react'
import { usePaneAddress } from './workspace.jsx'

const STORAGE_PREFIX = 'spex.page-scroll:'

export const pageScrollAddress = () => (
  typeof window === 'undefined' ? '' : `${window.location.pathname}${window.location.search}${window.location.hash}`
)

export function clearPageScrollPositions() {
  if (typeof sessionStorage === 'undefined') return
  for (let index = sessionStorage.length - 1; index >= 0; index--) {
    const key = sessionStorage.key(index)
    if (key?.startsWith(STORAGE_PREFIX)) sessionStorage.removeItem(key)
  }
}

const readPosition = (key) => {
  try { return Number(sessionStorage.getItem(`${STORAGE_PREFIX}${key}`)) || 0 } catch { return 0 }
}

const writePosition = (key, top) => {
  try { sessionStorage.setItem(`${STORAGE_PREFIX}${key}`, String(top)) } catch { /* storage may be walled off */ }
}

// A scroll position belongs to a DOCUMENT, and the document is the pane's address — not the window's.
// Once documents stay mounted while hidden ([[workspace-shell]]), reading the window's address here let a
// hidden page re-key onto whatever the reader had just opened and write its own (zero) position over that
// document's remembered one. The window's address remains the answer where there is no pane: the phone,
// the projects hub, the cold review entry each render one page and are that page.
export function PageScroll({ className = '', scrollKey, children, ...props }) {
  const paneAddress = usePaneAddress()
  const key = scrollKey ?? paneAddress ?? pageScrollAddress()
  const ref = useRef(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const targetTop = readPosition(key)
    let lastTop = targetTop
    let restoring = targetTop > 0
    let stableFrames = 0
    let frame = 0
    let observer

    const stopRestoring = () => {
      restoring = false
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      observer?.disconnect()
    }
    const restore = () => {
      frame = 0
      if (!restoring) return
      const maxTop = Math.max(0, element.scrollHeight - element.clientHeight)
      element.scrollTop = Math.min(targetTop, maxTop)
      if (maxTop < targetTop) { stableFrames = 0; return }
      if (Math.abs(element.scrollTop - targetTop) > 1) {
        stableFrames = 0
        frame = requestAnimationFrame(restore)
        return
      }
      lastTop = element.scrollTop
      writePosition(key, lastTop)
      // Chromium may apply its native history position after React's layout effect. Require the target
      // to survive a paint before yielding, so that temporary zero never becomes the remembered value.
      if (++stableFrames < 2) frame = requestAnimationFrame(restore)
      else stopRestoring()
    }
    const remember = () => {
      if (restoring) return
      lastTop = element.scrollTop
      writePosition(key, lastTop)
    }
    const snapshot = () => {
      stopRestoring()
      remember()
    }

    element.scrollTop = targetTop
    if (restoring) {
      observer = new MutationObserver(() => {
        if (!frame) frame = requestAnimationFrame(restore)
      })
      observer.observe(element, { childList: true, subtree: true, characterData: true })
      frame = requestAnimationFrame(restore)
    }
    element.addEventListener('scroll', remember, { passive: true })
    element.addEventListener('pointerdown', snapshot, true)
    element.addEventListener('wheel', snapshot, { passive: true, capture: true })
    element.addEventListener('keydown', snapshot, true)
    return () => {
      element.removeEventListener('scroll', remember)
      element.removeEventListener('pointerdown', snapshot, true)
      element.removeEventListener('wheel', snapshot, true)
      element.removeEventListener('keydown', snapshot, true)
      stopRestoring()
      writePosition(key, lastTop)
    }
  }, [key])

  return (
    <div ref={ref} className={`page-scroll${className ? ` ${className}` : ''}`} {...props}>
      {children}
    </div>
  )
}
