import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

// [[document-actions]]: the shell owns registration, while each document owns its action data. The API and
// state contexts stay separate for the same reason as StatusBar: an action changing must not invalidate the
// function identity every registrant depends on.
const DocumentActionApi = createContext(null)
const DocumentActionState = createContext(null)

const actionKey = (document, id) => `${document}\u0000${id}`
const renderKey = (action) => [
  action.document, action.id, action.icon, action.label, action.disabled ? '1' : '0',
  action.disabledReason || '', action.pressed ? '1' : '0', action.menuKey || (action.menu ? 'menu' : ''),
].join('|')

export function DocumentActionProvider({ children }) {
  const [actions, setActions] = useState(() => new Map())
  const register = useCallback((item) => {
    if (!item?.document || !item?.id) return
    const key = actionKey(item.document, item.id)
    setActions((previous) => {
      const before = previous.get(key)
      if (before && renderKey(before) === renderKey(item) && before.onClick === item.onClick) return previous
      return new Map(previous).set(key, { ...item, key })
    })
  }, [])
  const dispose = useCallback((document, id) => {
    const key = actionKey(document, id)
    setActions((previous) => {
      if (!previous.has(key)) return previous
      const next = new Map(previous)
      next.delete(key)
      return next
    })
  }, [])
  const api = useMemo(() => ({ register, dispose }), [register, dispose])
  const state = useMemo(() => ({ actions }), [actions])
  return <DocumentActionApi.Provider value={api}><DocumentActionState.Provider value={state}>{children}</DocumentActionState.Provider></DocumentActionApi.Provider>
}

// Registers one action for the caller's lifetime. `document` is the canonical route hash, not a page name,
// so two session faces can never leak actions into one another.
export function useDocumentAction(document, item) {
  const api = useContext(DocumentActionApi)
  const latest = useRef(item)
  latest.current = item
  const id = item?.id
  const stableOnClick = useMemo(() => (...args) => latest.current?.onClick?.(...args), [document, id])
  const key = renderKey({ document, ...item })
  useEffect(() => {
    if (!api || !document || !id) return undefined
    api.register({ ...latest.current, document, onClick: stableOnClick })
    return () => api.dispose(document, id)
  }, [api, document, id, key, stableOnClick])
  return null
}

export function useDocumentActions() {
  return useContext(DocumentActionState)?.actions || new Map()
}

export const documentActionKey = actionKey
