// when `currentId` isn't in the ring, enter at the first (forward) or last (back) item; null for an empty ring.
// `idOf` adapts the element shape: id strings use the identity default, node objects pass (n) => n.id.
export function cycleNext(items, currentId, dir = 1, idOf = (x) => x) {
  if (!items.length) return null
  const i = items.findIndex((x) => idOf(x) === currentId)
  if (i === -1) return dir > 0 ? items[0] : items[items.length - 1]
  return items[(i + dir + items.length) % items.length]
}
