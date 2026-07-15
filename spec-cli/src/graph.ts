import { basename } from 'path'
import { loadSpecs, deriveStatus } from './specs.js'
import { resolveLayout, readConfig } from './layout.js'
import { listSessions } from './sessions.js'
import { repoRoot, driftIndex, historyIndex } from './git.js'
import { residentForgeState } from '../../spec-forge/src/resident.js'
import { resolveForgeHost } from '../../spec-forge/src/drivers.js'
import { mergedIssues } from './issues.js'
import { evalContext, evalTimeline } from '../../spec-eval/src/evaltab.js'
import { evalNodesAsync, type ScenarioTestReference } from '../../spec-eval/src/scenarios.js'

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

// the board's eval summary ([[graph-lean]]): the LATEST reading per scenario, each kept as the VERBATIM
// reading object — a filter, never a projection. Consumers hang optional fields off a reading (the
// annotator's timelineBlob rides only video readings), so dropping a field here is a SILENT downstream
// degradation no error would surface; the field-preservation unit test pins this contract.
export function latestPerScenario<T extends { scenario: string }>(readings: T[]): T[] {
  const seen = new Set<string>()
  return readings.filter((r) => !seen.has(r.scenario) && (seen.add(r.scenario), true))
}

// the board's scenario fold ([[graph-lean]]): the declared set rides SLIM — name/tags plus the normalized
// test reference a measuring hand can follow. Prose and per-scenario code stay off the hot poll, carried by
// `/api/specs/lite` and `/api/specs/:id/evals`; the opaque test case name is metadata, not an executor seam.
export function slimScenarios(
  scenarios: { name: string; tags?: string[]; test?: ScenarioTestReference }[],
): { name: string; tags?: string[]; test?: ScenarioTestReference }[] {
  return scenarios.map((s) => ({
    name: s.name,
    ...(s.tags?.length ? { tags: s.tags } : {}),
    ...(s.test ? { test: s.test } : {}),
  }))
}

export async function buildBoard() {
  // all three sources are warm-cheap and independent, so the board inherits their speed for free: loadSpecs
  // REUSES the HEAD-keyed spec-history cache (the git-derived node data — see specs.ts/git.ts), resolveLayout
  // reuses the per-worktree overlay cache and recomputes only the deltas that actually changed (the live
  // OVERLAY), and listSessions takes its liveness from ONE batched tmux snapshot. Nothing here re-walks git.
  const root = repoRoot()
  const [layout, sessions, specs] = await Promise.all([resolveLayout(), listSessions(), loadSpecs()])
  // the eval fold's freshness axes: WARM hits — loadSpecs already computed this HEAD's drift + history
  // indices, so these are the same cached walks, fetched once and reused for every measurable node (the history
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
      // `body` and its derivation `parts` are DROPPED from the board payload ([[graph-lean]]): together ~56% of
      // the bytes, and detail the graph overview never renders. The detail view fetches them per node from
      // `/api/specs/:id/content` on open, and the search palette fetches the body corpus from `/api/specs/lite`
      // once on open — both off this hot poll. `undefined` makes JSON.stringify omit the keys.
      return { ...n, body: undefined, parts: undefined, overlays, status: deriveStatus({ version: n.version, drift: n.drift, hasOverlay: overlays.length > 0, hasCode: (n.code?.length ?? 0) > 0, fmStatus: n.fmStatus ?? undefined }) }
    }),
    ...Object.values(ghostById),
  ]
  // fold each node's issues onto it through the unified Issue port ([[issues]]): the resident forge slice
  // AND the local store's threads, one merged store-tagged list (full set → issues, open subset →
  // openIssues, attached only when non-empty). Non-blocking: residentForgeState never waits on `gh` and is
  // empty absent a forge, so the fold then carries the local slice alone. Sorted open-first, newest first.
  const isOpen = (i: { status: string }) => i.status === 'open'
  const merged = mergedIssues({ host: resolveForgeHost(), state: residentForgeState() }, nodes.map((n) => n.id))
  // ONE board-level freshness stamp over EVERY issue thread (noded or nodeless, both stores):
  // open-count : thread-count : reply-count : latest-activity. Every thread write — open, reply, remark,
  // resolve, retract, close — moves at least one component, so a store write ALWAYS moves board bytes:
  // [[graph-delta]] suppresses no-change broadcasts, and without a moving byte an external write would
  // stay invisible to viewers until the fallback poll ([[remark-substrate]] write-visibility). The per-node
  // fold below stays [[graph-lean]]-slim (no reply payloads); this stamp is the freshness carrier.
  const issuesStamp = [
    merged.filter(isOpen).length,
    merged.length,
    merged.reduce((n, i) => n + i.replies.length, 0),
    merged.flatMap((i) => [i.created, ...i.replies.flatMap((r) => [r.at, r.resolvedAt ?? ''])]).reduce((a, b) => (b > a ? b : a), ''),
  ].join(':')
  const issuesByNode: Record<string, ReturnType<typeof mergedIssues>> = {}
  for (const issue of merged)
    for (const nid of issue.nodes) (issuesByNode[nid] ??= []).push(issue)
  for (const n of nodes) {
    const issues = issuesByNode[n.id]
    if (!issues || !issues.length) continue
    n.issues = issues
      .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.created.localeCompare(a.created))
      .map((i) => ({ id: i.id, store: i.store, status: i.status, concern: i.concern, url: i.url }))
    const open = n.issues.filter(isOpen)
    if (open.length) n.openIssues = open
  }

  // fold each measurable node's eval state onto it — as the LEAN summary ([[graph-lean]]): `evals` carries only
  // the LATEST reading per scenario (newest-first), which is all any overview surface consumes (the score
  // badge, stats, search all reduce to latest-per-scenario anyway); the full timeline stays off the board
  // and is lazy-loaded by the eval tab from `/api/specs/:id/evals`. `scenarios` (the declared set) rides
  // SLIM — name/tags/test only, the fields every overview surface or measuring hand needs — with its prose
  // (description/expected) and per-scenario code off the hot poll: they ride the `/api/specs/lite` corpus
  // (search palette, focus-panel preview) and the `/api/specs/:id/evals` timeline (eval tab).
  // evalContext reuses the specs + driftIndex above; evalTimeline short-circuits non-measurable nodes. The
  // eval-file walk rides fs/promises ([[graph-cache]]) so it yields the event loop instead of stalling /health.
  const ynodes = await evalNodesAsync(root)
  const ectx = await evalContext(root, specs, idx, hidx, undefined, ynodes)
  await Promise.all(nodes.map(async (n) => {
    const tl = await evalTimeline(n.id, ectx)
    if (tl.hasEvalFile) { n.evals = latestPerScenario(tl.readings); n.scenarios = slimScenarios(tl.scenarios) }
  }))

  const opsByPath: Record<string, any[]> = {}
  opWts.forEach((w) => { opsByPath[w.path] = w.ops })
  const sess = sessions.map((s) => ({ ...s, source: s.path, ops: opsByPath[s.path] || [] }))

  const dash = readConfig(root).dashboard
  // project names the tab ([[tab-title]]); projectIcon is the tab favicon ([[tab-icon]]) — both ride the
  // /api/graph poll so they re-derive from whichever backend the viewer reached. Empty icon → frontend default.
  return { nodes, sessions: sess, project: dash?.title || basename(root), projectIcon: dash?.icon || '', issuesStamp }
}

// @@@ spliceSessions — the SESSIONS-ONLY producer ([[graph-cache]]). A session-scoped change (a lifecycle
// write, a liveness/activity poll flip) reshapes only the board's `sessions` rows — the node/meta units are
// untouched — so the cache re-derives ONLY the sessions and splices them onto the previous board verbatim,
// skipping the whole loadSpecs/layout/eval assembly a full buildBoard() pays. Pure aside from listSessions:
// each row is decorated EXACTLY as buildBoard's sess mapping (`{...s, source: s.path, ops}`), and every
// path's `ops` is REUSED from the previous board (a path→ops map). A session path absent in `prev` gets []
// — a brand-new worktree has no pending spec ops yet, and any later ops-CHANGING event (a commit, a
// worktree `.spec` edit) is refs/worktree-scoped, i.e. a FULL rebuild, never a sessions splice. So the
// splice is byte-indistinguishable from a full rebuild whenever only session state moved.
export async function spliceSessions(prev: Awaited<ReturnType<typeof buildBoard>>): Promise<Awaited<ReturnType<typeof buildBoard>>> {
  const sessions = await listSessions()
  const opsByPath: Record<string, any[]> = {}
  for (const s of prev.sessions) opsByPath[s.source] = s.ops
  const sess = sessions.map((s) => ({ ...s, source: s.path, ops: opsByPath[s.path] || [] }))
  return { ...prev, sessions: sess }
}
