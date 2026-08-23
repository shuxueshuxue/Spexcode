import { useSyncExternalStore } from 'react'

// The desktop dock and the mounted session console are two views of one session list. Keep the
// disclosure state outside either component so keyboard routing remains live when the dock is hidden,
// and pointer toggles still update the same tree the keyboard addresses.
let snapshot = { expanded: new Set(), offlineOpen: false }
const listeners = new Set()

const publish = (next) => {
  snapshot = next
  listeners.forEach((listener) => listener())
}

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useSessionListState = () => useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
export const getSessionListSnapshot = () => snapshot

export const toggleSessionFold = (id) => {
  if (!id) return
  const expanded = new Set(snapshot.expanded)
  if (expanded.has(id)) expanded.delete(id)
  else expanded.add(id)
  publish({ ...snapshot, expanded })
}

export const expandSessionFolds = (ids = []) => {
  const expanded = new Set(snapshot.expanded)
  ids.filter(Boolean).forEach((id) => expanded.add(id))
  if (expanded.size === snapshot.expanded.size && [...expanded].every((id) => snapshot.expanded.has(id))) return
  publish({ ...snapshot, expanded })
}

export const setSessionOfflineOpen = (open) => {
  const value = !!open
  if (value === snapshot.offlineOpen) return
  publish({ ...snapshot, offlineOpen: value })
}
