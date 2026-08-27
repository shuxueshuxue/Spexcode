import { useSyncExternalStore } from 'react'

// THE EXPLORER'S DISCLOSURE, held OUTSIDE the rows that draw it — one mechanism for the spec and disk
// projections, because the dock's collapse door must reach both without teaching either row about chrome.
//
// Two things were broken while each row owned its own `open` flag. A row is unmounted whenever its
// ancestor collapses or the whole dock folds, and unmounting a `useState` discards it: the reader's
// expansion was erased by a gesture that had nothing to do with it. And nothing outside a row could
// reach that state, so routing to a spec could not open the branch containing it — the tree claimed to
// be a view of the address while showing a closed root. The disk tree uses the same store shape so closing
// its Files section cannot forget the directories the reader opened.
//
// Kept in module scope rather than a context: the explorer mounts in the dock and, embedded, elsewhere,
// and both are views of ONE tree. Persisted per project so the shape of the tree a reader arranged is
// still there on the next boot, which is what "remembered" has to mean to be worth anything.
const ledger = (KEY) => {
  const read = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
      return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : [])
    } catch { return new Set() }
  }
  let snapshot = { open: read() }
  const listeners = new Set()
  const publish = (open) => {
    snapshot = { open }
    try { localStorage.setItem(KEY, JSON.stringify([...open])) } catch { /* private mode: live-only */ }
    listeners.forEach((listener) => listener())
  }
  return {
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    get: () => snapshot,
    toggle: (id) => {
      if (!id) return
      const open = new Set(snapshot.open)
      open.has(id) ? open.delete(id) : open.add(id)
      publish(open)
    },
    reveal: (ids) => {
      const wanted = ids.filter(Boolean)
      if (!wanted.length || wanted.every((id) => snapshot.open.has(id))) return
      const open = new Set(snapshot.open)
      wanted.forEach((id) => open.add(id))
      publish(open)
    },
    clear: () => { if (snapshot.open.size) publish(new Set()) },
  }
}

const specs = ledger('spex.specTreeOpen')
const dirs = ledger('spex.diskTreeOpen')

export const useSpecTreeState = () => useSyncExternalStore(specs.subscribe, specs.get, specs.get)
export const toggleSpecNode = (id) => specs.toggle(id)

// Open a whole path at once — the reveal a routed address asks for. It publishes only on a real change,
// so a route that lands on an already-visible node costs no render.
export const revealSpecPath = (ids = []) => {
  const wanted = ids.filter(Boolean)
  specs.reveal(wanted)
}

export const useDiskTreeState = () => useSyncExternalStore(dirs.subscribe, dirs.get, dirs.get)
export const toggleDiskDir = (path) => dirs.toggle(path)

const foldedSubscribe = (listener) => {
  const unsubs = [specs.subscribe(listener), dirs.subscribe(listener)]
  return () => unsubs.forEach((unsubscribe) => unsubscribe())
}
const folded = () => specs.get().open.size === 0 && dirs.get().open.size === 0
export const useExplorerFolded = () => useSyncExternalStore(foldedSubscribe, folded, folded)
export const collapseExplorerFolders = () => { specs.clear(); dirs.clear() }
