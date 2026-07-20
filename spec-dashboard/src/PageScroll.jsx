import { useLayoutEffect, useRef } from 'react'

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

export function PageScroll({ className = '', scrollKey = pageScrollAddress(), children, ...props }) {
  const ref = useRef(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const targetTop = readPosition(scrollKey)
    let lastTop = targetTop
    let restoring = targetTop > 0
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
      if (maxTop < targetTop) return
      lastTop = element.scrollTop
      writePosition(scrollKey, lastTop)
      stopRestoring()
    }
    const remember = () => {
      if (restoring) return
      lastTop = element.scrollTop
      writePosition(scrollKey, lastTop)
    }
    const snapshot = () => {
      stopRestoring()
      remember()
    }

    element.scrollTop = targetTop
    if (element.scrollTop === targetTop) {
      restoring = false
    } else if (restoring) {
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
      writePosition(scrollKey, lastTop)
    }
  }, [scrollKey])

  return (
    <div ref={ref} className={`page-scroll${className ? ` ${className}` : ''}`} {...props}>
      {children}
    </div>
  )
}
