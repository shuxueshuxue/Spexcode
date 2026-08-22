import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { usePaneActive } from './workspace.jsx'

// The shell's one capture listener. Scopes return true when they consumed an event; returning false leaves
// native controls and the next lower-priority owner alone. Registration is ref-backed so stateful views can
// update their handler without replacing the listener on every render.
const KeyboardServiceContext = createContext(null)

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
