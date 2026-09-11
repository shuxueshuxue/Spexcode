import { createContext, createElement, useCallback, useContext, useMemo, useRef } from 'react'

const SelectionContext = createContext(null)

const ownerOf = (node) => typeof Node !== 'undefined' && node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement

export function nativeSelectionWithin(root) {
  if (typeof document === 'undefined' || !root) return null
  const selection = document.getSelection?.()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  return range.cloneRange()
}

export function nativeSnapshot(root, { surfaceId, semantic = null } = {}) {
  const range = nativeSelectionWithin(root)
  if (!range) return null
  const text = range.toString()
  if (!text) return null
  const rect = range.getBoundingClientRect?.()
  return {
    surfaceId,
    kind: 'dom',
    text,
    semantic: typeof semantic === 'function' ? semantic(range) : semantic,
    visualRect: rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null,
    source: range,
  }
}

export function clearNativeSelection(root) {
  if (typeof document === 'undefined' || !root) return
  const selection = document.getSelection?.()
  if (!selection || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)
  if (root.contains(range.commonAncestorContainer)) selection.removeAllRanges()
}

export function readerIsSelecting() {
  const native = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null
  return !!native && !native.isCollapsed && String(native).trim().length > 0
}

export function observeNativeSelection(root, options = {}) {
  if (!root || typeof document === 'undefined') return () => {}
  const { surfaceId, semantic, onSnapshot } = options
  const read = () => onSnapshot?.(nativeSnapshot(root, { surfaceId, semantic }))
  const onSelectionChange = () => read()
  const onPointerUp = () => requestAnimationFrame(read)
  document.addEventListener('selectionchange', onSelectionChange)
  root.addEventListener('mouseup', onPointerUp)
  root.addEventListener('keyup', onPointerUp)
  read()
  return () => {
    document.removeEventListener('selectionchange', onSelectionChange)
    root.removeEventListener('mouseup', onPointerUp)
    root.removeEventListener('keyup', onPointerUp)
  }
}

export function SelectionProvider({ children }) {
  const currentRef = useRef(null)
  const publish = useCallback((snapshot) => {
    currentRef.current = snapshot
  }, [])
  const clear = useCallback((surfaceId) => {
    if (surfaceId && currentRef.current?.surfaceId !== surfaceId) return
    currentRef.current = null
  }, [])
  const value = useMemo(() => ({ currentRef, publish, clear }), [publish, clear])
  return createElement(SelectionContext.Provider, { value }, children)
}

export function useSelectionController() {
  const value = useContext(SelectionContext)
  if (!value) throw new Error('useSelectionController must be used under SelectionProvider')
  return value
}

export const selectionNode = ownerOf
