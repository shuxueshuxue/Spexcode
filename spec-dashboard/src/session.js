// status→colour values are theme tokens (styles.css :root) so the palette stays single-sourced; var() resolves in inline styles.
export const STATUS_COLOR = {
  working: 'var(--green)', parked: 'var(--green)',
  asking: 'var(--yellow)', review: 'var(--yellow)', done: 'var(--yellow)',
  error: 'var(--red)',
  idle: 'var(--muted)', starting: 'var(--muted)', queued: 'var(--muted)',
  'close-pending': 'var(--muted)', offline: 'var(--muted)',
}

// compact one-line surfaces (the console's terminal-styled sidebar) render the status as a SINGLE glyph
// instead of the word — STATUS_COLOR still paints it, and the exact word stays in the title/aria for hover +
// a11y. One terminal-ish mark per lifecycle; same four-hue traffic-light meaning as the word it replaces.
export const STATUS_GLYPH = {
  working: '●', parked: '‖',
  asking: '?', review: '◑', done: '✓',
  error: '✕',
  idle: '·', starting: '◌', queued: '⋯', 'close-pending': '⊘', offline: '○',
}

// the two triage zones the session list groups into — "whose turn is it?". `need` = the ball is with the
// HUMAN (asking / review / done / close-pending / error → answer, review, close, fix); `run` = self-driving,
// the agent's turn (working / parked / starting / queued / idle / offline). Closed sessions aren't on the
// board at all, so there is no archive zone here. Same partition drives every session-list surface.
const NEED_STATUS = new Set(['asking', 'review', 'done', 'close-pending', 'error'])
export const sessionZone = (s) => (NEED_STATUS.has(s?.status) ? 'need' : 'run')
export const ZONE_ORDER = ['need', 'run']
// zone-partition the list: needs-you zone first, self-running below; and WITHIN each zone the NEWEST session
// on top (descending effective time = sortKey ?? created) — the fresh, recently-touched work you actually
// reach for, not the oldest. Drag-reorder ([[session-reorder]]) still pins within a zone on this same axis.
const effOf = (s) => (s?.sortKey != null ? s.sortKey : (s?.created ?? 0))
export const zoneSort = (sessions) => {
  const rank = { need: 0, run: 1 }
  return [...sessions].sort((a, b) => rank[sessionZone(a)] - rank[sessionZone(b)] || effOf(b) - effOf(a))
}

// the STABLE identity of a session: a user-chosen rename (`name`) wins over everything; else its node,
// else title/branch, else the raw id. Mirrors the backend's sessionLabel precedence (spec-cli sessions.ts).
// Used where a session needs a fixed handle that doesn't move turn-to-turn — tooltips, the lock hint, search.
export const sessionName = (s) => s?.name || s?.node || s?.title || s?.branch || s?.id

export const sessionHeadline = (s) =>
  s?.name || s?.activity || s?.promptPreview || s?.node || s?.title || s?.branch || s?.id

// @@@ session nesting ([[session-nesting]]) — a session launched by `spex new` from INSIDE another carries
// that spawner's id as `parent`. Fold it into a forest, DERIVED here at read time (never stored on the child):
// a child nests under its parent ONLY IF that parent is present in this list, so a closed parent's children
// auto-promote to top-level on the next board read. Returns the top-level `roots` (a real parent or an orphan
// whose parent is gone) and `childrenOf` (parentId → its direct children), both recursive to any depth.
export function nestSessions(sessions) {
  const present = new Set(sessions.map((s) => s?.id))
  const childrenOf = new Map()
  const roots = []
  for (const s of sessions) {
    const p = s?.parent && s.parent !== s.id && present.has(s.parent) ? s.parent : null
    if (p) { const arr = childrenOf.get(p) || []; arr.push(s); childrenOf.set(p, arr) }
    else roots.push(s)
  }
  return { roots, childrenOf }
}

// @@@ subtree rollup ([[session-nesting]]) — the disclosure-triangle COLOUR: a PURELY informational summary of
// the hidden subtree that must NOT touch the parent's own status/glyph/zone/sort. Dark-yellow if ANY descendant
// needs attention (the needs-you zone, error folded in — the widest signal wins); else green if any descendant
// is actively running (a STATUS_COLOR-green status: working/parked); else neutral (all idle/offline). Reuses
// the STATUS_COLOR hues so the triangle speaks the same four-hue language as every other status mark.
export function subtreeRollup(id, childrenOf) {
  let need = false, run = false
  const walk = (pid, seen) => {
    for (const c of childrenOf.get(pid) || []) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      if (NEED_STATUS.has(c.status)) need = true
      else if (STATUS_COLOR[c.status] === STATUS_COLOR.working) run = true
      walk(c.id, seen)
    }
  }
  walk(id, new Set([id]))
  return need ? STATUS_COLOR.asking : run ? STATUS_COLOR.working : STATUS_COLOR.idle
}

// @@@ the ordered render list ([[session-nesting]]) both session-list surfaces share. Roots are zone-sorted by
// their OWN status (no aggregation), each carrying a zone header when the zone changes; a parent's children
// follow it (zone-sorted among themselves) ONLY when `isExpanded(id)` — collapsed by default, so a fleet reads
// as one row. Emits {type:'zone',zone} and {type:'row', s, depth, expandable, expanded, rollup}; the visible
// row order is also what ↑/↓ nav and drag-reorder walk, so a collapsed child is never a hidden nav target.
export function sessionForest(sessions, isExpanded) {
  const { roots, childrenOf } = nestSessions(sessions)
  const items = []
  const emit = (s, depth, seen) => {
    const kids = childrenOf.get(s.id) || []
    const expandable = kids.length > 0
    const expanded = expandable && !!isExpanded(s.id)
    items.push({ type: 'row', s, depth, expandable, expanded, rollup: expandable ? subtreeRollup(s.id, childrenOf) : null })
    if (expanded) for (const c of zoneSort(kids)) { if (!seen.has(c.id)) { seen.add(c.id); emit(c, depth + 1, seen) } }
  }
  const seen = new Set()
  let prevZone = null
  for (const r of zoneSort(roots)) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    const z = sessionZone(r)
    if (z !== prevZone) { items.push({ type: 'zone', zone: z }); prevZone = z }
    emit(r, 0, seen)
  }
  return items
}
