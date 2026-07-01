import { basename } from 'path'
import { loadSpecs, deriveStatus } from './specs.js'
import { resolveLayout, readConfig } from './layout.js'
import { listSessions } from './sessions.js'
import { repoRoot, driftIndex, historyIndex } from './git.js'
import { residentForgeView } from '../../spec-forge/src/resident.js'
import { evalContext, evalTimeline } from '../../spec-yatsu/src/evaltab.js'

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
  // all three sources are warm-cheap and independent, so the board inherits their speed for free: loadSpecs
  // REUSES the HEAD-keyed spec-history cache (the git-derived node data — see specs.ts/git.ts), resolveLayout
  // reuses the per-worktree overlay cache and recomputes only the deltas that actually changed (the live
  // OVERLAY), and listSessions takes its liveness from ONE batched tmux snapshot. Nothing here re-walks git.
  const root = repoRoot()
  const [layout, sessions, specs] = await Promise.all([resolveLayout(), listSessions(), loadSpecs()])
  // the eval fold's freshness axes: WARM hits — loadSpecs already computed this HEAD's drift + history
  // indices, so these are the same cached walks, fetched once and reused for every yatsu node (the history
  // index drives the rename-safe scenario axis, mirroring a spec node's own freshness).
  const idx = await driftIndex(root)
  const hidx = await historyIndex(root)
  const worktrees = layout.worktrees.filter((w) => !w.isMain)
  // resolveLayout already zeroed ops for unmanaged worktrees, so this is just "has pending changes".
  const opWts = worktrees.filter((w) => w.ops && w.ops.length)

  const sessIdByPath: Record<string, string> = {}
  sessions.forEach((s) => { sessIdByPath[s.path] = s.id })
  const seedOf = (path: string): string => sessIdByPath[path] || path

  const byId: Record<string, any> = Object.fromEntries(specs.map((n) => [n.id, n]))
  const byDir: Record<string, string> = {}
  specs.forEach((n: any) => { if (n.path) byDir[n.path.replace(/\/spec\.md$/, '')] = n.id })
  // register each added node's own dir in byDir first, so resolveParent can chain a new node to its new
  // ghost ancestor (a whole added subtree renders as one tree, not a flat scatter of roots).
  for (const w of opWts) for (const op of w.ops) {
    if (op.op === 'added') byDir[op.path.replace(/\/spec\.md$/, '')] = op.nodeId
  }

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
          desc: '', code: [], related: [], body: '', drift: 0, driftFiles: [], ghost: true, overlays: [ov],
        }
      } else {
        (overlaysByNode[op.nodeId] ??= []).push(ov)
      }
    }
  }

  // re-derive status WITH the overlay so a node an unmerged worktree is touching reads `active` — the only
  // place in-flight work is known, so the only place `active` is produced.
  const nodes = [
    ...specs.map((n: any) => {
      const overlays = overlaysByNode[n.id] || []
      // `body` and its derivation `parts` are DROPPED from the board payload ([[board-lean]]): together ~56% of
      // the bytes, and detail the graph overview never renders. The detail view fetches them per node from
      // `/api/specs/:id/content` on open, and the search palette fetches the body corpus from `/api/specs/lite`
      // once on open — both off this hot poll. `undefined` makes JSON.stringify omit the keys.
      return { ...n, body: undefined, parts: undefined, overlays, status: deriveStatus({ version: n.version, drift: n.drift, hasOverlay: overlays.length > 0, hasCode: (n.code?.length ?? 0) > 0, fmStatus: n.fmStatus ?? undefined }) }
    }),
    ...Object.values(ghostById),
  ]
  // fold spec-forge issues onto each node (full set → issues, open subset → openIssues, attached only when
  // non-empty), non-blocking: residentForgeView never waits on `gh` and returns [] absent a forge, so a
  // forge-less board is unchanged. Sorted open-first, newest number first.
  const isOpen = (i: any) => (i.state || '').toLowerCase() === 'open'
  const issuesByNode: Record<string, any[]> = {}
  for (const link of residentForgeView(nodes.map((n) => n.id))) {
    issuesByNode[link.node] = link.issues
      .map((i) => ({ number: i.number, state: i.state, title: i.title, url: i.url }))
      .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.number - a.number)
  }
  for (const n of nodes) {
    const issues = issuesByNode[n.id]
    if (!issues || !issues.length) continue
    n.issues = issues
    const open = issues.filter(isOpen)
    if (open.length) n.openIssues = open
  }

  // fold each yatsu node's eval timeline onto it, riding this one board poll: `evals` (readings, newest-first)
  // and `scenarios` (the declared set) attached only when the node declares scenarios. evalContext reuses the
  // specs + driftIndex above; evalTimeline short-circuits non-yatsu nodes so the poll stays fast.
  const ectx = evalContext(root, specs, idx, hidx)
  await Promise.all(nodes.map(async (n) => {
    const tl = await evalTimeline(n.id, ectx)
    if (tl.hasYatsu) { n.evals = tl.readings; n.scenarios = tl.scenarios }
  }))

  const opsByPath: Record<string, any[]> = {}
  opWts.forEach((w) => { opsByPath[w.path] = w.ops })
  const sess = sessions.map((s) => ({ ...s, source: s.path, ops: opsByPath[s.path] || [] }))

  const dash = readConfig(root).dashboard
  // project names the tab ([[tab-title]]); projectIcon is the tab favicon ([[tab-icon]]) — both ride the
  // /api/board poll so they re-derive from whichever backend the viewer reached. Empty icon → frontend default.
  return { nodes, sessions: sess, project: dash?.title || basename(root), projectIcon: dash?.icon || '' }
}
