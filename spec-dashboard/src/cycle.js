// @@@ cycleNext - the shared "walk a ring of nodes" primitive. From `currentId`, step `dir` (+1 forward,
// -1 back) to the next item, wrapping at the ends; when `currentId` isn't in the ring, ENTER at the first
// (forward) or last (back) item. Returns the next item, or null for an empty ring. This is the one spine
// under every "walk the matching nodes" affordance: the o/O overlay cycle ([[keyboard-nav]]) steps focus
// through a worktree's changed nodes with it, and every board-stats chip ([[board-stats]]) steps focus
// through the nodes IT counts with it — so a repeated key press AND a repeated click advance the same way.
// `idOf` adapts the ring's element shape: id strings use the identity default, node objects pass (n) => n.id.
export function cycleNext(items, currentId, dir = 1, idOf = (x) => x) {
  if (!items.length) return null
  const i = items.findIndex((x) => idOf(x) === currentId)
  if (i === -1) return dir > 0 ? items[0] : items[items.length - 1]
  return items[(i + dir + items.length) % items.length]
}
