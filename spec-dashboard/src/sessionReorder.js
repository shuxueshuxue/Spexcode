export const effTime = (s) => (s.sortKey != null ? s.sortKey : s.created)
export const REORDER_GAP = 1000   // headroom (ms) when a row is dropped past either end

// repeated midpoint bisection eventually exhausts double precision; when a midpoint can't fall strictly
// between two neighbours, re-space the whole list on an even grid anchored at the earliest effective time.
// `desc` = the list is shown NEWEST-FIRST (descending effTime), so the TOP row must get the LARGEST key.
function renormalise(order, desc) {
  const base = Math.min(...order.map(effTime))
  const n = order.length
  return order.map((s, i) => ({ id: s.id, key: base + (desc ? (n - i) : (i + 1)) * REORDER_GAP }))
}

// `desc` flips the one-sided (dropped past an end) and renormalise directions for a newest-first list; the
// two-sided midpoint is direction-agnostic. Default ascending leaves any oldest-first caller unchanged.
export function reorderPlan(order, draggedId, beforeId, desc = false) {
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
  else if (left) key = effTime(left) + (desc ? -REORDER_GAP : REORDER_GAP)
  else if (right) key = effTime(right) + (desc ? REORDER_GAP : -REORDER_GAP)
  else return null
  const lo = left && right ? Math.min(effTime(left), effTime(right)) : -Infinity
  const hi = left && right ? Math.max(effTime(left), effTime(right)) : Infinity
  const tight = left && right && !(key > lo && key < hi)
  return { order: newOrder, updates: tight ? renormalise(newOrder, desc) : [{ id: draggedId, key }] }
}
