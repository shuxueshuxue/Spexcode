// Resolve the desktop session-list chords without mutating selection or fold state. The Dock owns the
// state transition; this pure door keeps the modifier grammar testable and makes leaf no-ops explicit.
export function resolveSessionShortcut(rows, activeId, event) {
  if (!event?.altKey || event.ctrlKey || event.metaKey) return null
  // Option can expose a dead-key value in `key` on macOS and on non-US layouts. The
  // physical arrow code is stable, matching the shell's other modifier bindings.
  const direction = event.code || event.key
  if (direction !== 'ArrowUp' && direction !== 'ArrowDown') return null
  const current = rows.find((item) => item.type === 'row' && item.s.id === activeId)
  if (!current) return null
  if (event.shiftKey) {
    return {
      type: current.expandable ? (direction === 'ArrowDown' ? 'expand' : 'collapse') : 'noop',
      id: current.s.id,
    }
  }
  const visible = rows.filter((item) => item.type === 'row')
  const index = visible.findIndex((item) => item.s.id === activeId)
  const next = visible[index + (direction === 'ArrowDown' ? 1 : -1)]
  return next ? { type: 'move', id: next.s.id } : { type: 'noop' }
}
