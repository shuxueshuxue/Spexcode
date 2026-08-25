import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

// [[document-actions]]: the shell owns registration, while each document owns its action data. The API and
// state contexts stay separate for the same reason as StatusBar: an action changing must not invalidate the
// function identity every registrant depends on.
const DocumentActionApi = createContext(null)
const DocumentActionState = createContext(null)

const actionKey = (document, id) => `${document}\u0000${id}`
// `menuKey`/`nodeKey` are how a document states that content the frame cannot inspect has changed: a React
// element is opaque to a value comparison, so an action that draws itself names its own state the same way
// a popup does. Without that, the registry keeps the FIRST element it was handed and the action goes stale
// while its data moves on.
const renderKey = (action) => [
  action.document, action.id, action.icon, action.label, action.disabled ? '1' : '0',
  action.disabledReason || '', action.pressed ? '1' : '0', action.menuKey || (action.menu ? 'menu' : ''),
  action.nodeKey || (action.node ? 'node' : ''),
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

// ---------------------------------------------------------------------------------------------------

// THE DOCUMENT'S OWN NAME, for chrome that has to draw a document it is not rendering. [[tab-strip]] labels
// every tab from the board's resident projections — a node's title, a session's headline — and that covers
// every document whose name is already in memory. An ISSUE's is not: the issues board is paged and the
// detail fetches itself, so the strip had nothing but the id and drew `#7f3a1b2c` where the reader had put
// a sentence.
//
// This is NOT the second lookup table the strip forbids. That rule forbids a second SOURCE, free to
// disagree with the first; here there is exactly one writer and it is the document being named. It is a
// module store rather than a context value for the same reason the open list is one: a name has to outlive
// its document's mount, or a tab would lose its label the moment the pool evicted the document behind it.
// Keyed by the OBJECT address (page + selector, no query), because the name belongs to the thing, not to
// the view state some address variant carries.
const names = new Map()
const nameListeners = new Set()

export function reportDocumentName(document, name) {
  const text = typeof name === 'string' ? name.trim() : ''
  if (!document || !text || names.get(document) === text) return
  names.set(document, text)
  const snapshot = new Map(names)
  for (const listener of [...nameListeners]) listener(snapshot)
}

export function useDocumentNames() {
  const [snapshot, setSnapshot] = useState(() => new Map(names))
  useEffect(() => {
    nameListeners.add(setSnapshot)
    setSnapshot(new Map(names))
    return () => { nameListeners.delete(setSnapshot) }
  }, [])
  return snapshot
}

// The writer's side, as a hook so a document reports its name the way it registers an action.
export function useReportDocumentName(document, name) {
  useEffect(() => { reportDocumentName(document, name) }, [document, name])
  return null
}
