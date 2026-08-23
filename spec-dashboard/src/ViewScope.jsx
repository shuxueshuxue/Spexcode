import { createContext, useContext } from 'react'

const ViewScopeContext = createContext(null)

export function ViewScopeProvider({ scope, children }) {
  return <ViewScopeContext.Provider value={scope}>{children}</ViewScopeContext.Provider>
}

// A view may only ask its own shell host for route work. Throwing outside a host catches accidental use in
// global chrome at development/test time instead of silently routing through a second authority.
export function useViewScope() {
  const scope = useContext(ViewScopeContext)
  if (!scope) throw new Error('useViewScope must be used inside a ViewHost')
  return scope
}

export function useOptionalViewScope() {
  return useContext(ViewScopeContext)
}
