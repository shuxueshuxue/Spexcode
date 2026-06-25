// @@@ session-reorder - the brain of the drag-to-reorder gesture (the spec node owns this file). It turns a
// drop ("move this row to sit just before that one") into the sort-key WRITES to persist, and nothing else:
// no DOM, no fetch, no React — SessionInterface wires the events, data.js does the POST. Reordering is a
// PSEUDO-TIME override: every row sorts by `sortKey ?? created`, so the manual order and the birth order live
// on one axis. A drag rewrites ONE row's key to the MIDPOINT of its new neighbours — the override is LOCAL,
// the neighbours keep their real birth time, and a later-born session still slots in by `created`.

// the effective sort value of a session: its manual key if set, else its real birth time.
export const effTime = (s) => (s.sortKey != null ? s.sortKey : s.created)

// headroom (ms) when a row is dropped past either end — it lands one step beyond the current end row.
export const REORDER_GAP = 1000

// @@@ renormalise - the rare precision repair. Bisecting the same gap ~50 times exhausts double precision,
// so when a midpoint can't fall strictly between two neighbours we lay the WHOLE list on an evenly spaced
// grid anchored at the earliest effective time. Returns the writes for every row; the normal path never hits
// it. Anchoring at the min keeps magnitudes realistic so a brand-new session (larger `created`) still appends.
function renormalise(order) {
  const base = Math.min(...order.map(effTime))
  return order.map((s, i) => ({ id: s.id, key: base + (i + 1) * REORDER_GAP }))
}

// @@@ reorderPlan - plan a drag. `order` is the current display order (already sorted by effTime); move
// `draggedId` to sit just before `beforeId` (null = append to the end). Returns { order, updates } — the new
// row order and the sort-key writes to persist (normally the one dragged row; the whole list on a renormalise)
// — or null when the move is a no-op (same slot, single-item list, or an unknown id).
export function reorderPlan(order, draggedId, beforeId) {
  if (draggedId === beforeId) return null
  const from = order.findIndex((s) => s.id === draggedId)
  if (from < 0) return null
  const dragged = order[from]
  const rest = order.filter((s) => s.id !== draggedId)
  const at = beforeId == null ? rest.length : rest.findIndex((s) => s.id === beforeId)
  if (at < 0) return null
  const newOrder = [...rest.slice(0, at), dragged, ...rest.slice(at)]
  if (newOrder.every((s, i) => s.id === order[i].id)) return null   // position unchanged → nothing to write

  const left = newOrder[at - 1], right = newOrder[at + 1]
  let key
  if (left && right) key = (effTime(left) + effTime(right)) / 2
  else if (left) key = effTime(left) + REORDER_GAP
  else if (right) key = effTime(right) - REORDER_GAP
  else return null   // dragged is the only row
  const tight = left && right && !(key > effTime(left) && key < effTime(right))
  return { order: newOrder, updates: tight ? renormalise(newOrder) : [{ id: draggedId, key }] }
}
