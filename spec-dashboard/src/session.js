import { sessionHandle, sessionHeadline, sessionPresent } from '@spexcode/spec-core/review'

export { sessionHandle, sessionHeadline, sessionPresent }

// status→colour values are theme tokens (styles.css :root) so the palette stays single-sourced; var() resolves in inline styles.
export const STATUS_COLOR = {
  working: 'var(--green)', parked: 'var(--green)',
  asking: 'var(--yellow)', review: 'var(--yellow)', done: 'var(--yellow)',
  error: 'var(--red)',
  idle: 'var(--muted)', starting: 'var(--muted)', queued: 'var(--muted)',
  'close-pending': 'var(--muted)', offline: 'var(--muted)',
  unknown: 'var(--yellow)',   // liveness probe FAILED (box overloaded) — death unproven, so warn, never read as dead
  corrupt: 'var(--red)',      // the RECORD itself is unreadable — a broken thing to look at, not a dead agent
  retired: 'var(--muted)',    // the work merged and its worktree is gone: terminal, only `close` remains
}

// compact one-line surfaces (the console's terminal-styled sidebar) render the status as a SINGLE glyph
// instead of the word — STATUS_COLOR still paints it, and the exact word stays in the title/aria for hover +
// a11y. One terminal-ish mark per lifecycle; same four-hue traffic-light meaning as the word it replaces.
export const STATUS_GLYPH = {
  working: '●', parked: '‖',
  asking: '?', review: '◑', done: '✓',
  error: '✕',
  idle: '·', starting: '◌', queued: '⋯', 'close-pending': '⊘', offline: '○', unknown: '⁇',
  corrupt: '⚠', retired: '⚑',
}

// Fixed board buckets consume the status published by the session package. The dashboard does not replace an
// authored lifecycle with a liveness probe: a dead review/asking/close-pending record remains needs-you.
const NEED_STATUS = new Set(['asking', 'review', 'done', 'close-pending', 'error', 'corrupt'])
export const sessionDisplayState = (s) => {
  const status = s?.status || 'idle'
  const zone = s?.archived
    ? 'archive'
    : NEED_STATUS.has(status)
      ? 'need'
      : status === 'offline' || status === 'retired' ? 'offline'
        : 'run'
  return {
    zone,
    status,
    color: STATUS_COLOR[status] || STATUS_COLOR.idle,
    glyph: STATUS_GLYPH[status] || STATUS_GLYPH.idle,
  }
}
export const sessionZone = (s) => sessionDisplayState(s).zone
export const isArchived = (s) => !!s?.archived
export const sessionFooterState = (s) => {
  if (isArchived(s)) return 'archived'
  if (s?.status !== 'queued' && (s?.status === 'offline' || s?.liveness === 'offline')) return 'offline'
  return 'live'
}
// @@@ overlay sessions - the ONE node->session crossing join ([[node-menu]]): a node's pending overlays
// name WORKTREE PATHS, and a session row carries that same path as `source`, so the join is path equality,
// deduped and in overlay order. Every node action menu — the graph tile's and the document prose menu's —
// answers "which sessions are changing this node" through THIS, so the two surfaces can never disagree
// about the crossing. An overlay whose worktree has no live session row simply drops out.
export const overlaySessions = (node, sessions = []) => {
  const sources = [...new Set((node?.overlays || []).map((o) => o.source))]
  return sources.map((source) => (sessions || []).find((s) => s.source === source)).filter(Boolean)
}
// @@@ session spec nodes - the MIRROR of overlaySessions ([[session-rename]]'s spec-related door): the
// nodes THIS session is changing, read from the same pending ops the graph overlay is drawn from, in
// overlay order. Each carries its OP, because "added" and "deleted" are not the same news as "edited" and
// the board already says which is which in one shared mark. A node is listed once — the first op naming it
// wins, since a worktree makes one pending change per spec.md. No node is resolved against the trunk here:
// a node the session is ADDING has no row there yet and must still be listed.
export const sessionSpecNodes = (session) => {
  const seen = new Map()
  for (const op of (session?.ops) || []) {
    if (!op?.nodeId || seen.has(op.nodeId)) continue
    seen.set(op.nodeId, { id: op.nodeId, op: op.op || 'edited' })
  }
  return [...seen.values()]
}

// what the spec door actually renders: the first `max` of those nodes plus how many the cap held back. The
// cap keeps a wide session from pushing a menu's own verbs off the screen, and `hidden` is what makes the
// omission SAYABLE — a door that silently showed eight of twenty would read as "these are the nodes".
export const specDoorRows = (session, max) => {
  const all = sessionSpecNodes(session)
  const rows = max > 0 ? all.slice(0, max) : all
  return { rows, hidden: all.length - rows.length }
}
// the ONE liveness join: resolve an id against the board sessions and return the
// session only while it is ALIVE (listed and not offline) — the same alive/offline judgment the originator
// chip renders (Thread.jsx). A non-session id ('human', a github
// login) resolves to null, honestly.
export const liveSession = (sessions, id) => {
  const s = id ? (sessions || []).find((x) => x.id === id) : null
  return s && s.status !== 'offline' && s.liveness !== 'offline' && !isArchived(s) ? s : null
}
// the ONE source-session PRESENCE join ([[live-session-filter]] — the session:present|missing facet):
// does the id still resolve to a session on the current board at ALL, any zone? Presence, not liveness —
// the facet asks "is the source still around", never "is it online".
// order the working list by its active lifecycle zones; closed sessions live in a separate flat collection.
// each zone the NEWEST session on top (descending effective time) — the fresh, recently-touched work you
// actually reach for, not the oldest.
const effOf = (s) => (s?.sortKey != null ? s.sortKey : (s?.created ?? 0))
export const zoneSort = (sessions) => {
  const rank = { need: 0, run: 1, offline: 2, archive: 3 }
  return [...sessions].sort((a, b) => rank[sessionZone(a)] - rank[sessionZone(b)] || effOf(b) - effOf(a))
}

// the session's display strings are DERIVED SERVER-SIDE ([[session-label]]): the wire carries `label`
// (stable handle) and `headline` (the live line a human reads), computed once in toSession; the bare parts
// (rename `name`, prompt-truncation `title`) don't ride the wire at the top level, so a surface CANNOT
// re-derive its own chain — these two accessors are the only doors, and the legacy chain below each exists
// solely as the old-backend fallback, confined to THIS file. Reach for s.raw.name / s.raw.title only for an
// explicitly raw consumer (the rename prefill).
//
// `sessionHandle` is the STABLE identity — the value a row or tab uses for "which session is this". On a
// current backend the wire always carries `label`, so this door short-circuits there: a rename name or prompt
// summary remains stable while activity, readiness and infra notes change in the secondary status slot.
// Raw id/node/branch fragments are deliberately NOT promised searchable except as the final fallback.
// `sessionHeadline` remains available for live prose surfaces (chat, timeline, and archive search) where the
// changing activity line is the content being read, not the session identity.

export function nestSessions(sessions) {
  const byId = new Map(sessions.map((s) => [s?.id, s]))
  // Legacy/imported records can contain a malformed parent cycle even though the write path rejects one.
  // Find those cycle members first, then promote just that cycle to roots; descendants still keep their
  // direct edge to the promoted member instead of disappearing with the malformed family.
  const state = new Map()
  const cycleIds = new Set()
  const scan = (id, trail, positions) => {
    if (state.get(id) === 'done') return
    if (state.get(id) === 'visiting') {
      const start = positions.get(id)
      if (start != null) for (const cycleId of trail.slice(start)) cycleIds.add(cycleId)
      return
    }
    const session = byId.get(id)
    if (!session) return
    state.set(id, 'visiting')
    const parent = session.parent && session.parent !== id ? session.parent : null
    if (parent && byId.has(parent)) {
      const nextTrail = [...trail, id]
      const nextPositions = new Map(positions)
      nextPositions.set(id, trail.length)
      scan(parent, nextTrail, nextPositions)
    }
    state.set(id, 'done')
  }
  for (const s of sessions) if (s?.id) scan(s.id, [], new Map())

  const childrenOf = new Map()
  const roots = []
  for (const s of sessions) {
    const parentId = cycleIds.has(s?.id) ? null : s?.parent && s.parent !== s.id ? s.parent : null
    const parent = parentId ? byId.get(parentId) : null
    const p = parent ? parent.id : null
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

export function subtreeRollup(id, childrenOf) {
  let need = false, run = false, count = 0
  const walk = (pid, seen) => {
    for (const c of childrenOf.get(pid) || []) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      count++
      const display = sessionDisplayState(c)
      if (NEED_STATUS.has(display.status)) need = true
      else if (STATUS_COLOR[display.status] === STATUS_COLOR.working) run = true
      walk(c.id, seen)
    }
  }
  walk(id, new Set([id]))
  return { color: need ? STATUS_COLOR.asking : run ? STATUS_COLOR.working : STATUS_COLOR.idle, count }
}

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

// The natural working-list order behind session lists: zones, newest-first roots, and recursive parent-before-
// child disclosure as sessionForest. The archive index deliberately bypasses this and remains flat.
export const sessionPresentationOrder = (sessions) =>
  sessionForest(sessions, () => true).filter((item) => item.type === 'row').map((item) => item.s)
