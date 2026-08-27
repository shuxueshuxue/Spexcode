import { useSyncExternalStore } from 'react'

// THE SPEC TREE'S DISCLOSURE, held OUTSIDE the rows that draw it — the same shape the session forest
// already uses ([[session-forest]]'s fold store), because it is the same problem twice.
//
// Two things were broken while each row owned its own `open` flag. A row is unmounted whenever its
// ancestor collapses or the whole dock folds, and unmounting a `useState` discards it: the reader's
// expansion was erased by a gesture that had nothing to do with it. And nothing outside a row could
// reach that state, so routing to a spec could not open the branch containing it — the tree claimed to
// be a view of the address while showing a closed root.
//
// Kept in module scope rather than a context: the explorer mounts in the dock and, embedded, elsewhere,
// and both are views of ONE tree. Persisted per project so the shape of the tree a reader arranged is
// still there on the next boot, which is what "remembered" has to mean to be worth anything.
const KEY = 'spex.specTreeOpen'

const read = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : [])
  } catch { return new Set() }   // private mode / cleared storage: an empty tree is a correct tree
}

let snapshot = { open: read() }
const listeners = new Set()

const publish = (open) => {
  snapshot = { open }
  try { localStorage.setItem(KEY, JSON.stringify([...open])) } catch { /* private mode: live-only */ }
  listeners.forEach((listener) => listener())
}

const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useSpecTreeState = () => useSyncExternalStore(subscribe, () => snapshot, () => snapshot)

export const toggleSpecNode = (id) => {
  if (!id) return
  const open = new Set(snapshot.open)
  open.has(id) ? open.delete(id) : open.add(id)
  publish(open)
}

export const collapseSpecTree = () => {
  if (!snapshot.open.size) return
  publish(new Set())
}

// Open a whole path at once — the reveal a routed address asks for. It publishes only on a real change,
// so a route that lands on an already-visible node costs no render.
export const revealSpecPath = (ids = []) => {
  const wanted = ids.filter(Boolean)
  if (!wanted.length || wanted.every((id) => snapshot.open.has(id))) return
  const open = new Set(snapshot.open)
  wanted.forEach((id) => open.add(id))
  publish(open)
}
