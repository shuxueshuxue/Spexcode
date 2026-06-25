// @@@ session-reorder - the brain of the drag-to-reorder gesture (the spec node owns this file). It turns a
// drop ("move this row to sit just before that one") into the sort-key WRITES to persist, and nothing else:
// no DOM, no fetch, no React. Reordering is a PSEUDO-TIME override: every row sorts by `sortKey ?? created`,
// so the manual order and the birth order live on one axis. A drag rewrites ONE row's key to the MIDPOINT of
// its new neighbours — the override is LOCAL, the neighbours keep their real birth time.

export const effTime = (s) => (s.sortKey != null ? s.sortKey : s.created)
export const REORDER_GAP = 1000   // headroom (ms) when a row is dropped past either end

// @@@ renormalise - the rare precision repair. Bisecting the same gap ~50 times exhausts double precision, so
// when a midpoint can't fall strictly between two neighbours we lay the WHOLE list on an evenly spaced grid
// anchored at the earliest effective time. The normal path never hits it.
function renormalise(order) {
  const base = Math.min(...order.map(effTime))
  return order.map((s, i) => ({ id: s.id, key: base + (i + 1) * REORDER_GAP }))
}

// @@@ reorderPlan - plan a drag. `order` is the current display order (sorted by effTime); move `draggedId`
// to sit just before `beforeId` (null = append). Returns { order, updates } — the new row order and the
// sort-key writes to persist (the one dragged row, or the whole list on a renormalise) — or null on a no-op.
export function reorderPlan(order, draggedId, beforeId) {
  if (draggedId === beforeId) return null
  const from = order.findIndex((s) => s.id === draggedId)
  if (from < 0) return null
  const dragged = order[from]
  const rest = order.filter((s) => s.id !== draggedId)
  const at = beforeId == null ? rest.length : rest.findIndex((s) => s.id === beforeId)
  if (at < 0) return null
  const newOrder = [...rest.slice(0, at), dragged, ...rest.slice(at)]
  if (newOrder.every((s, i) => s.id === order[i].id)) return null   // position unchanged

  const left = newOrder[at - 1], right = newOrder[at + 1]
  let key
  if (left && right) key = (effTime(left) + effTime(right)) / 2
  else if (left) key = effTime(left) + REORDER_GAP
  else if (right) key = effTime(right) - REORDER_GAP
  else return null
  const tight = left && right && !(key > effTime(left) && key < effTime(right))
  return { order: newOrder, updates: tight ? renormalise(newOrder) : [{ id: draggedId, key }] }
}
