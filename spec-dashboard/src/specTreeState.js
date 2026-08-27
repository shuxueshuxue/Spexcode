import { useSyncExternalStore } from 'react'

// THE EXPLORER'S DISCLOSURE, held OUTSIDE the rows that draw it — the same shape the session forest
// already uses ([[session-forest]]'s fold store), because it is the same problem twice. Two ledgers, one
// mechanism: which SPEC NODES are open ([[file-tree]]) and which DISK DIRECTORIES are open ([[disk-tree]]).
//
// Two things were broken while each row owned its own `open` flag. A row is unmounted whenever its
// ancestor collapses or the whole dock folds, and unmounting a `useState` discards it: the reader's
// expansion was erased by a gesture that had nothing to do with it. And nothing outside a row could
// reach that state, so routing to a spec could not open the branch containing it — the tree claimed to
// be a view of the address while showing a closed root. The disk tree had the first defect for as long as
// its directories kept row-local flags: closing the Files section forgot every folder inside it.
//
// Holding both ledgers here is also what lets ONE door fold the whole explorer: "collapse folders" is a
// property of the explorer, not of either projection, so it lives on the dock head that both sections
// share ([[dock-modes]]) and clears both ledgers in one publish.
//
// Kept in module scope rather than a context: the explorer mounts in the dock and, embedded, elsewhere,
// and both are views of ONE tree. Persisted per project so the shape of the tree a reader arranged is
// still there on the next boot, which is what "remembered" has to mean to be worth anything.
const ledger = (KEY) => {
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
  return {
    subscribe,
    get: () => snapshot,
    toggle: (id) => {
      if (!id) return
      const open = new Set(snapshot.open)
      open.has(id) ? open.delete(id) : open.add(id)
      publish(open)
    },
    // Open a whole set at once — the reveal a routed address asks for. It publishes only on a real
    // change, so a route that lands on an already-visible node costs no render.
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
export const revealSpecPath = (ids = []) => specs.reveal(ids)

export const useDiskTreeState = () => useSyncExternalStore(dirs.subscribe, dirs.get, dirs.get)
export const toggleDiskDir = (path) => dirs.toggle(path)

// The explorer is FOLDED when neither ledger holds an open folder; the door that folds it is disabled then
// rather than hidden, so the head keeps one shape whether or not there is anything to collapse.
const foldedSubscribe = (listener) => {
  const unsubscribes = [specs.subscribe(listener), dirs.subscribe(listener)]
  return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
}
const folded = () => specs.get().open.size === 0 && dirs.get().open.size === 0
export const useExplorerFolded = () => useSyncExternalStore(foldedSubscribe, folded, folded)
export const collapseExplorerFolders = () => { specs.clear(); dirs.clear() }
