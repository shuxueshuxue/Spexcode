import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { usePaneActive } from './workspace.jsx'
import { consumeEscape } from './escStack.js'

// The shell's one capture listener. Scopes return true when they consumed an event; returning false leaves
// native controls and the next lower-priority owner alone. Registration is ref-backed so stateful views can
// update their handler without replacing the listener on every render.
const KeyboardServiceContext = createContext(null)

// A typing surface owns every unmodified key. Keep this predicate beside the shell service so routed
// views do not grow subtly different copies (the xterm helper is a textarea, as are both composers).
export function isTypingTarget(target) {
  if (!target) return false
  if (target.isContentEditable) return true
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true
  return Boolean(target.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))
}

export function KeyboardServiceProvider({ children }) {
  const scopes = useRef(new Map())
  const nextId = useRef(0)
  const register = useCallback((handler, priority = 0) => {
    const id = ++nextId.current
    scopes.current.set(id, { handler, priority })
    return () => scopes.current.delete(id)
  }, [])
  const value = useMemo(() => ({ register }), [register])

  useEffect(() => {
    const onKey = (event) => {
      // Escape layers are the highest-priority owner. Keeping this arbitration in the service means no
      // overlay needs a second capture listener that can race the shell or a routed view.
      if (consumeEscape(event)) { event.stopPropagation(); return }
      const owners = [...scopes.current.entries()]
        .sort((a, b) => b[1].priority - a[1].priority || b[0] - a[0])
      for (const [, owner] of owners) {
        if (owner.handler(event) || event.cancelBubble) {
          event.stopPropagation()
          return
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return <KeyboardServiceContext.Provider value={value}>{children}</KeyboardServiceContext.Provider>
}

// A HIDDEN DOCUMENT HOLDS NO KEYS. Documents stay mounted while they are not showing ([[workspace-shell]]'s
// mounted-document pool), and a mounted scope is a claim on every keystroke — the graph's j/k walk would go
// on answering while the reader typed into a spec beside it. Being on screen is the condition for owning
// the keyboard, so the pane's own answer decides whether the registration happens at all; a view outside
// any pane (the phone, the hub, the sealed build) is always its window's only view and always registers.
export function useKeyboardScope(handler, priority = 0) {
  const { register } = useContext(KeyboardServiceContext) || {}
  const active = usePaneActive()
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    if (!register || !active) return undefined
    return register((event) => handlerRef.current(event), priority)
  }, [register, priority, active])
}
