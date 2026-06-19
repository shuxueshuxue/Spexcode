import { loadSpecs, deriveStatus } from './specs.js'
import { resolveLayout } from './layout.js'
import { listSessions } from './sessions.js'

// @@@ buildBoard - the dashboard's RUNTIME state, assembled in ONE shared module so the human (HTTP
// /api/board) and an agent (`spex board`) see the IDENTICAL board. The only thing left to the frontend
// is the x/y tidy-tree layout (pixels — the backend has no notion of them). Everything else — merged
// tree, per-worktree overlay (ghosts for adds, edit/delete/move marks), drift, and the session list —
// is computed here from the same specs/layout/sessions modules the CLI uses.

// a ghost (added) node's parent: the existing node whose directory is the longest prefix of the new one.
function resolveParent(path: string, byDir: Record<string, string>): string | null {
  const dir = path.replace(/\/spec\.md$/, '')
  const segs = dir.split('/')
  for (let k = segs.length - 1; k > 0; k--) {
    const anc = segs.slice(0, k).join('/')
    if (byDir[anc]) return byDir[anc]
  }
  return null
}

export async function buildBoard() {
  const [layout, sessions, specs] = await Promise.all([resolveLayout(), listSessions(), loadSpecs()])
  const worktrees = layout.worktrees.filter((w) => !w.isMain)
  // resolveLayout already zeroed ops for unmanaged worktrees, so this is just "has pending changes".
  const opWts = worktrees.filter((w) => w.ops && w.ops.length)

  // @@@ seed not colour - the board no longer PICKS colours. It emits a stable `seed` per worktree and the
  // dashboard derives the colour from it (color.js), the SAME seed an avatar face is hashed from — so a
  // session's face and every mark that names it (node ring, ⏎ link, reparent edge, session stripe) share
  // one hue. The seed is the worktree's LIVE session id when it has one (so it matches the session-row
  // stripe, which seeds off the same id), else the worktree path as a stable fallback.
  const sessIdByPath: Record<string, string> = {}
  sessions.forEach((s) => { sessIdByPath[s.path] = s.id })
  const seedOf = (path: string): string => sessIdByPath[path] || path

  const byId: Record<string, any> = Object.fromEntries(specs.map((n) => [n.id, n]))
  const byDir: Record<string, string> = {}
  specs.forEach((n: any) => { if (n.path) byDir[n.path.replace(/\/spec\.md$/, '')] = n.id })

  const overlaysByNode: Record<string, any[]> = {}
  const ghostById: Record<string, any> = {}
  for (const w of opWts) {
    const source = w.path, label = w.node || w.branch || w.path, seed = seedOf(w.path)
    for (const op of w.ops) {
      const ov = {
        op: op.op, source, label, branch: w.branch, seed,
        committed: op.committed, dirty: op.dirty,
        toParent: op.op === 'moved' ? resolveParent(op.toPath || op.path, byDir) : null,
      }
      if (op.op === 'added' && !byId[op.nodeId]) {
        if (ghostById[op.nodeId]) { ghostById[op.nodeId].overlays.push(ov); continue }
        // a ghost is a node being ADDED by a worktree but not yet on main -> it has a pending op,
        // so its derived status is `active` (live, in-flight), never `pending`.
        ghostById[op.nodeId] = {
          id: op.nodeId, parent: resolveParent(op.path, byDir), path: op.path,
          title: op.nodeId, status: deriveStatus({ version: 0, drift: 0, hasOverlay: true }),
          version: 0, session: null, fmStatus: null,
          desc: '', code: [], evidence: [], body: '', drift: 0, driftFiles: [], ghost: true, overlays: [ov],
        }
      } else {
        (overlaysByNode[op.nodeId] ??= []).push(ov)
      }
    }
  }

  // @@@ overlay-aware status - loadSpecs derived status from git alone (pending|drift|merged); here we
  // re-derive WITH the overlay so a node an unmerged worktree is touching reads `active`. This is the
  // one place that knows about in-flight work, so it's the only place `active` can be produced.
  const nodes = [
    ...specs.map((n: any) => {
      const overlays = overlaysByNode[n.id] || []
      return { ...n, overlays, status: deriveStatus({ version: n.version, drift: n.drift, hasOverlay: overlays.length > 0, fmStatus: n.fmStatus ?? undefined }) }
    }),
    ...Object.values(ghostById),
  ]
  const opsByPath: Record<string, any[]> = {}
  opWts.forEach((w) => { opsByPath[w.path] = w.ops })
  // session rows carry no colour — the dashboard seeds each row's stripe off the session id (labelColor),
  // the same seed its avatar face uses, so the two always match.
  const sess = sessions.map((s) => ({ ...s, source: s.path, ops: opsByPath[s.path] || [] }))

  return { nodes, sessions: sess }
}
