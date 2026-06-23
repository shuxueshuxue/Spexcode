import { basename } from 'path'
import { loadSpecs, deriveStatus } from './specs.js'
import { resolveLayout, readConfig } from './layout.js'
import { listSessions } from './sessions.js'
import { repoRoot, driftIndex } from './git.js'
import { residentForgeView } from '../../spec-forge/src/resident.js'
import { evalContext, evalTimeline } from '../../spec-yatsu/src/evaltab.js'

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
  // all three sources are warm-cheap and independent, so the board inherits their speed for free: loadSpecs
  // REUSES the HEAD-keyed spec-history cache (the git-derived node data — see specs.ts/git.ts), resolveLayout
  // reuses the per-worktree overlay cache and recomputes only the deltas that actually changed (the live
  // OVERLAY), and listSessions takes its liveness from ONE batched tmux snapshot. Nothing here re-walks git.
  const root = repoRoot()
  const [layout, sessions, specs] = await Promise.all([resolveLayout(), listSessions(), loadSpecs()])
  // the eval fold's freshness axis: a WARM hit here — loadSpecs already computed this HEAD's driftIndex, so
  // this is the same cached walk, fetched once and reused for every yatsu node (never re-run per node).
  const idx = await driftIndex(root)
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
  // @@@ ghost ancestry - a worktree can ADD a whole new subtree at once (e.g. `extract` scaffolding a
  // fresh root with many nested nodes). Each new node's parent is ITSELF a ghost — absent from main's
  // byDir — so resolving against byDir alone returns null and the board renders every new node as a root
  // (no tree at all). Register every added node's own dir up front, so resolveParent can chain a new node
  // to its new ancestor and only the genuine subtree root stays parentless.
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
          desc: '', code: [], lastDiff: { hash: '', patch: '' }, body: '', drift: 0, driftFiles: [], ghost: true, overlays: [ov],
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
      return { ...n, overlays, status: deriveStatus({ version: n.version, drift: n.drift, hasOverlay: overlays.length > 0, hasCode: (n.code?.length ?? 0) > 0, fmStatus: n.fmStatus ?? undefined }) }
    }),
    ...Object.values(ghostById),
  ]
  // @@@ issue fold - lay each node's bound issues (spec-forge) onto it. `issues` is the FULL linked set
  // (open + closed) the node-info Issues tab lists; `openIssues` is the open subset the glance badge +
  // hover popover read. NON-BLOCKING and SILENT by construction: residentForgeView serves the last
  // background reconcile (never waits on `gh`) and returns [] when there's no forge/gh/auth — so a
  // forge-less board is byte-for-byte what it was, no badge and no error. Only issues here (a node DEFINES,
  // an issue DOES); PRs already read on the board as session/overlay state. Both fields are attached only
  // when non-empty. Open sorts before closed, newest number first, so the tab reads live-work-first. Read-
  // only — status stays git-derived.
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

  // @@@ eval fold - lay each node's evaluation timeline (spec-yatsu) onto it, the SAME single-source pattern
  // as issues/overlays/lastDiff. The eval tab now rides THIS one board poll instead of a separate per-node
  // fetch — that fetch never reset on a node switch, so the tab briefly showed the PRIOR node's readings and
  // loaded at a different time than the panes that ride the board. evalContext reuses the specs + driftIndex
  // computed above (one git-derived read, not re-run per node) plus one yatsu walk; evalTimeline short-circuits
  // every non-yatsu node on that walk, so only the few yatsu nodes touch their sidecar and the poll stays fast.
  // `evals` is the readings array (newest-first), attached ONLY when the node declares scenarios (a yatsu.md):
  // its presence IS the eval tab's hasYatsu signal — absent = no scenarios, an empty array = no reading yet.
  const ectx = evalContext(root, specs, idx)
  await Promise.all(nodes.map(async (n) => {
    const tl = await evalTimeline(n.id, ectx)
    if (tl.hasYatsu) n.evals = tl.readings
  }))

  const opsByPath: Record<string, any[]> = {}
  opWts.forEach((w) => { opsByPath[w.path] = w.ops })
  // session rows carry no colour — the dashboard seeds each row's stripe off the session id (labelColor),
  // the same seed its avatar face uses, so the two always match.
  const sess = sessions.map((s) => ({ ...s, source: s.path, ops: opsByPath[s.path] || [] }))

  // @@@ project - the browser-tab name this backend identifies itself by. Default is the launch folder
  // (basename of the repo root); `spexcode.json`'s `dashboard.title` overrides it when a project wants a
  // hand-picked name. The dashboard is a project-agnostic viewer pointed at ONE backend per dev-server
  // (see the api-endpoint node), so the payload carries its own identity: the frontend names the tab
  // after it, making each tab self-identifying when several projects each run their own backend.
  return { nodes, sessions: sess, project: readConfig(root).dashboard?.title || basename(root) }
}
