// status→colour values are theme tokens (styles.css :root) so the palette stays single-sourced; var() resolves in inline styles.
export const STATUS_COLOR = {
  working: 'var(--green)', parked: 'var(--green)',
  asking: 'var(--yellow)', review: 'var(--yellow)', done: 'var(--yellow)',
  error: 'var(--red)',
  idle: 'var(--muted)', starting: 'var(--muted)', queued: 'var(--muted)',
  'close-pending': 'var(--muted)', offline: 'var(--muted)',
  unknown: 'var(--yellow)',   // liveness probe FAILED (box overloaded) — death unproven, so warn, never read as dead
}

// compact one-line surfaces (the console's terminal-styled sidebar) render the status as a SINGLE glyph
// instead of the word — STATUS_COLOR still paints it, and the exact word stays in the title/aria for hover +
// a11y. One terminal-ish mark per lifecycle; same four-hue traffic-light meaning as the word it replaces.
export const STATUS_GLYPH = {
  working: '●', parked: '‖',
  asking: '?', review: '◑', done: '✓',
  error: '✕',
  idle: '·', starting: '◌', queued: '⋯', 'close-pending': '⊘', offline: '○', unknown: '⁇',
}

// the three triage zones the session list groups into — "whose turn is it?". `offline` = the process is
// DEAD/dormant (can't act until relaunched) — checked FIRST, because a session whose process died while
// asking/review/error keeps that pre-death lifecycle, yet it belongs at the bottom, not under Needs You.
// `need` = the ball is with the HUMAN (asking / review / done / close-pending / error → answer, review,
// close, fix); `run` = self-driving, the agent's turn (working / parked / starting / queued / idle — booting
// counts as running, not dead). Closed sessions aren't on the board at all. Same partition drives every
// session-list surface.
const NEED_STATUS = new Set(['asking', 'review', 'done', 'close-pending', 'error'])
export const sessionZone = (s) => {
  if (s?.liveness === 'offline' || s?.status === 'offline') return 'offline'
  return NEED_STATUS.has(s?.status) ? 'need' : 'run'
}
export const ZONE_ORDER = ['need', 'run', 'offline']
// the ONE liveness join: resolve an id against the board sessions and return the
// session only while it is ALIVE (listed and not offline) — the same alive/offline judgment the originator
// chip renders (Thread.jsx). A non-session id ('human', a github
// login) resolves to null, honestly.
export const liveSession = (sessions, id) => {
  const s = id ? (sessions || []).find((x) => x.id === id) : null
  return s && sessionZone(s) !== 'offline' ? s : null
}
// the ONE source-session PRESENCE join ([[live-session-filter]] — the session:present|missing facet):
// does the id still resolve to a session on the current board at ALL, any zone? Presence, not liveness —
// the facet asks "is the source still around", never "is it online".
export const sessionPresent = (sessions, id) => {
  const s = id ? (sessions || []).find((x) => x.id === id) : null
  return s || null
}
// zone-partition the list: needs-you first, self-running next, offline (dormant) at the bottom; and WITHIN
// each zone the NEWEST session on top (descending effective time) — the fresh, recently-touched work you
// actually reach for, not the oldest.
const effOf = (s) => (s?.sortKey != null ? s.sortKey : (s?.created ?? 0))
export const zoneSort = (sessions) => {
  const rank = { need: 0, run: 1, offline: 2 }
  return [...sessions].sort((a, b) => rank[sessionZone(a)] - rank[sessionZone(b)] || effOf(b) - effOf(a))
}

// the session's display strings are DERIVED SERVER-SIDE ([[session-label]]): the wire carries `label`
// (stable handle) and `headline` (the live line a human reads), computed once in toSession; the bare parts
// (rename `name`, prompt-truncation `title`) don't ride the wire at the top level, so a surface CANNOT
// re-derive its own chain — these two accessors are the only doors, and the legacy chain below each exists
// solely as the old-backend fallback, confined to THIS file. Reach for s.raw.name / s.raw.title only for an
// explicitly raw consumer (the rename prefill).
//
// `sessionHandle` is the STABLE handle — its ONLY sanctioned uses are the avatar/hover TOOLTIP, mobile's
// handle-line, and search MATCHING. On a current backend the wire always carries `label`, so this door
// short-circuits there: what search matches IS the label (a rename name or the prompt truncation);
// raw id/node/branch fragments are deliberately NOT promised searchable.
// It is NEVER a visible one-line title: EVERY surface where a human reads "which session is this" (board
// rows, the map window, Enter tabs, the console strip, the search palette, the @-mention dropdown, and the
// node-menu overlay list) renders `sessionHeadline`. Naming the stable door `Handle`, not `Name`, is the
// architectural guard: a dev wanting "the name to show" reaches for the headline by reflex and can no longer
// grab the handle by mistake — the divergence that kept recurring ([[session-activity]]: one name everywhere).
export const sessionHandle = (s) =>
  s?.label || s?.name || s?.node || s?.title || s?.branch || s?.id

export const sessionHeadline = (s) =>
  s?.headline || s?.name || s?.activity || s?.promptPreview || s?.node || s?.title || s?.branch || s?.id

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

// Present ancestors of one session, nearest first. This mirrors nestSessions' rule that a missing parent
// makes its child a root, and bounds malformed cycles so an external jump can safely reveal the row.
export function sessionAncestorIds(sessions, id) {
  const byId = new Map(sessions.map((s) => [s?.id, s]))
  const ids = []
  const seen = new Set([id])
  let cur = byId.get(id)
  while (cur?.parent && !seen.has(cur.parent)) {
    const parent = byId.get(cur.parent)
    if (!parent) break
    ids.push(parent.id)
    seen.add(parent.id)
    cur = parent
  }
  return ids
}

// @@@ subtree rollup ([[session-nesting]]) — the count-badge COLOUR: a PURELY informational summary of the
// hidden subtree that must NOT touch the parent's own status/glyph/zone/sort. Dark-yellow if ANY descendant
// needs attention (the needs-you zone, error folded in — the widest signal wins); else green if any descendant
// is actively running (a STATUS_COLOR-green status: working/parked); else neutral (all idle/offline). Reuses
// the STATUS_COLOR hues so the badge speaks the same four-hue language as every other status mark.
export function subtreeRollup(id, childrenOf) {
  let need = false, run = false, count = 0
  const walk = (pid, seen) => {
    for (const c of childrenOf.get(pid) || []) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      count++
      if (NEED_STATUS.has(c.status)) need = true
      else if (STATUS_COLOR[c.status] === STATUS_COLOR.working) run = true
      walk(c.id, seen)
    }
  }
  walk(id, new Set([id]))
  return { color: need ? STATUS_COLOR.asking : run ? STATUS_COLOR.working : STATUS_COLOR.idle, count }
}

// @@@ the ordered render list ([[session-nesting]]) both session-list surfaces share. Roots are zone-sorted by
// their OWN status (no aggregation), each carrying a zone header when the zone changes; a parent's children
// follow it (zone-sorted among themselves) ONLY when `isExpanded(id)` — collapsed by default, so a fleet reads
// as one row. Emits {type:'zone',zone} and {type:'row', s, depth, expandable, expanded, rollup, guides}; the
// visible row order is also what ↑/↓ nav and drag-reorder walk, so a collapsed child is never a hidden nav
// target. `guides` is the file-tree rail vector, one bool per connector column (length === depth): the LAST
// entry marks whether THIS row has a following sibling (branch tee vs end elbow), each earlier entry whether
// the ancestor in that column continues (draw a pass-through vertical line vs blank).
//
// @@@ offline-history fold ([[session-console]]) — the OFFLINE zone rests folded behind its header, the one
// disclosure for retained session history: `zoneFolded(zone)` names the folded zones (per-surface state; the
// product folds only 'offline', collapsed by default), and a folded zone emits its header — enriched with the
// hidden `count` and `folded: true` so the surface renders it as the disclosure — but none of its rows,
// EXCEPT any row `keepVisible(s)` claims (the current selection / graph lock): a session reached by URL,
// search, or a menu stays a visible row even while its zone is folded. Presentation only — no record is
// touched — and never applicable to the needs-you / running zones, whose rows this fold cannot hide.
export function sessionForest(sessions, isExpanded, { zoneFolded = () => false, keepVisible = () => false } = {}) {
  const { roots, childrenOf } = nestSessions(sessions)
  const items = []
  const emit = (s, depth, seen, guides) => {
    const kids = childrenOf.get(s.id) || []
    const expandable = kids.length > 0
    const expanded = expandable && !!isExpanded(s.id)
    const roll = expandable ? subtreeRollup(s.id, childrenOf) : null
    items.push({ type: 'row', s, depth, expandable, expanded, rollup: roll?.color ?? null, kin: roll?.count ?? 0, guides })
    if (expanded) {
      const vis = zoneSort(kids).filter((c) => !seen.has(c.id))
      vis.forEach((c, i) => { seen.add(c.id); emit(c, depth + 1, seen, [...guides, i < vis.length - 1]) })
    }
  }
  // a folded subtree still counts everything it hides (the root and every descendant), so the disclosure's
  // number is the whole history, not just its top-level rows.
  const subtreeSize = (s, seen) => {
    let n = 1
    for (const c of childrenOf.get(s.id) || []) { if (seen.has(c.id)) continue; seen.add(c.id); n += subtreeSize(c, seen) }
    return n
  }
  const seen = new Set()
  let prevZone = null
  let zoneItem = null
  for (const r of zoneSort(roots)) {
    if (seen.has(r.id)) continue
    const z = sessionZone(r)
    if (z !== prevZone) {
      zoneItem = { type: 'zone', zone: z, count: 0, folded: !!zoneFolded(z) }
      items.push(zoneItem)
      prevZone = z
    }
    // the zone's count is its WHOLE population (every root and descendant), folded or not — the
    // disclosure chip must not read 0 the moment the zone is open.
    zoneItem.count += subtreeSize(r, new Set([...seen, r.id]))
    if (zoneItem.folded) {
      // still emit any row (at any depth) the surface pinned visible — flat, since its nesting context
      // is folded away with the rest.
      const pinned = []
      const collect = (s, walked) => {
        if (keepVisible(s) && !seen.has(s.id)) pinned.push(s)
        for (const c of childrenOf.get(s.id) || []) { if (walked.has(c.id)) continue; walked.add(c.id); collect(c, walked) }
      }
      collect(r, new Set([r.id]))
      for (const s of pinned) { seen.add(s.id); items.push({ type: 'row', s, depth: 0, expandable: false, expanded: false, rollup: null, kin: 0, guides: [] }) }
      seen.add(r.id)
      continue
    }
    seen.add(r.id)
    emit(r, 0, seen, [])
  }
  return items
}
