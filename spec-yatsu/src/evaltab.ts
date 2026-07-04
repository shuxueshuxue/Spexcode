import { relative, dirname } from 'node:path'
import { repoRoot, driftIndex, historyIndex, type DriftIndex, type HistoryIndex } from '../../spec-cli/src/git.js'
import { loadSpecs } from '../../spec-cli/src/specs.js'
import { loadEvalRemarkTracks, trackKey, type RemarkTrack, type Issue, type Reply } from '../../spec-cli/src/issues.js'
import { yatsuNodes, type YatsuNode } from './yatsu.js'
import { readReadings, evidenceOf, type Verdict, type EvidenceKind } from './sidecar.js'
import { staleAxes, type StaleAxis } from './freshness.js'
import { hasBlob, getBlob, MISS_BLOB } from './cache.js'

// one evidence entry as the tab renders it: the content hash, its kind, and its LIVE blob state (present, or
// miss when the bytes were pruned). The whole list is the gallery the dashboard maps.
export type EvidenceView = { hash: string; kind: EvidenceKind; state: 'present' | 'miss' }

// a remark overlaid onto the reading it judged ([[remark-teeth]] R2): the resolvable fields the eval
// surfaces read, plus `dangling` when its targetCodeSha matched no reading (so it was attached to the
// scenario's latest as a fallback, never hidden). The teeth read the whole scenario track; THIS is the
// per-reading display attachment.
export type RemarkView = {
  rid: string
  ref: string             // `<thread-id>#<rid>` — the address `spex resolve`/`spex retract` take
  by: string
  at: string
  body: string
  targetCodeSha: string
  resolved: boolean
  resolvedAt?: string
  resolvedBy?: string
  dangling: boolean
}

export type EvalEntry = {
  scenario: string
  expected: string
  codeSha: string
  // the reading's whole evidence list (N images and/or a video and/or a transcript). Always populated —
  // a legacy scalar reading normalizes to a one-entry list — so every read surface sees a gallery.
  evidence?: EvidenceView[]
  // primary scalar view (the video entry if any, else the first) — the single-evidence compat face for
  // consumers that still read one blob (the session proof, the board fold's kind hint).
  blob: string | null
  blobKind?: EvidenceKind
  timelineBlob?: string
  evaluator: string
  verdict?: Verdict
  ts: string
  fresh: boolean
  staleAxes: StaleAxis[]
  blobState: 'present' | 'miss' | 'none'
  // the trunk remark track overlaid onto THIS reading ([[remark-teeth]]): the remarks whose targetCodeSha
  // pins here (or the latest reading, for a dangling target). Absent when the scenario has no remark.
  remarks?: RemarkView[]
  // the (node, scenario) eval-remark THREAD ([[eval-issue-split]]): the SAME join the teeth read, attached
  // so the eval detail pane reads its whole comment thread from the reading overlay — the counterpart to
  // splitting eval-remark threads OUT of the issue surfaces (mergedIssues). Absent until the first remark.
  thread?: Issue
}

// a remark overlaid onto its display host (a reading, above) → the RemarkView the surfaces read.
function toRemarkView(rm: Reply, threadId: string, dangling: boolean): RemarkView {
  return {
    rid: rm.rid!,
    ref: `${threadId}#${rm.rid}`,
    by: rm.by, at: rm.at, body: rm.body,
    targetCodeSha: rm.targetCodeSha ?? '',
    resolved: !!rm.resolved,
    ...(rm.resolvedAt ? { resolvedAt: rm.resolvedAt } : {}),
    ...(rm.resolvedBy ? { resolvedBy: rm.resolvedBy } : {}),
    dangling,
  }
}

// a DANGLING track ([[remark-teeth]]'s dangling clause / directive 5): a (node, scenario) remark track whose
// scenario no reading joins — the scenario was renamed or deleted, so today the track loads but surfaces
// nowhere. It ages NOTHING (there is no reading to stale — the teeth read per-reading), but its remarks must
// stay VISIBLE and resolvable/retractable via their refs, so evalTimeline emits one synthetic row per orphan
// at NODE level. `scenario` is the orphaned name (rendered struck-through / gone); `remarks` are all dangling.
export type DanglingTrack = { scenario: string; threadId: string; thread: Issue; remarks: RemarkView[] }

export type ScenarioInfo = { name: string; expected: string; tags?: string[]; code?: string[] }

// `hasYatsu` distinguishes a node that declares no scenarios (no yatsu.md) from one that declares some but
// has no readings yet — the tab says different things for each. `scenarios` is the declared set; `readings`
// is NEWEST-FIRST (the sidecar is append-only oldest→newest; the tab leads with the latest measurement,
// like the history tab).
export type EvalTimeline = {
  node: string
  hasYatsu: boolean
  scenarios: ScenarioInfo[]
  readings: EvalEntry[]
  // orphaned remark tracks (renamed/deleted scenarios) — surfaced at node level so their remarks never vanish
  // ([[remark-teeth]] dangling clause). SEPARATE from `readings` on purpose: a dangling track has no reading,
  // so it must NOT flow into latestPerScenario / the board scoreboard — it ages nothing.
  dangling: DanglingTrack[]
}

export type EvalContext = {
  root: string
  specs: Awaited<ReturnType<typeof loadSpecs>>
  idx: DriftIndex
  hidx: HistoryIndex
  ynodes: YatsuNode[]
  // the trunk remark tracks ([[remark-teeth]]), keyed (node, scenario) — loaded ONCE per board/proof build
  // and reused for every node, so the fold never re-reads the issue store per node.
  remarks: Map<string, RemarkTrack>
}

// build the shared context with ONE yatsu walk, reusing the caller's already-computed specs + the two
// HEAD-keyed git indices (drift for the code axis, history for the rename-safe scenario axis — both warm
// hits, loadSpecs already derived them). The remark tracks are the fourth, non-git freshness input
// ([[remark-teeth]]); a caller that omits them gets a live load, so a bare evalTimeline still has teeth.
export function evalContext(
  root: string,
  specs: Awaited<ReturnType<typeof loadSpecs>>,
  idx: DriftIndex,
  hidx: HistoryIndex,
  remarks?: Map<string, RemarkTrack>,
  ynodes?: YatsuNode[],   // the hot board build precomputes these off the event loop (yatsuNodesAsync); a bare caller walks sync
): EvalContext {
  return { root, specs, idx, hidx, ynodes: ynodes ?? yatsuNodes(root), remarks: remarks ?? loadEvalRemarkTracks() }
}

export async function evalTimeline(id: string, ctx?: EvalContext): Promise<EvalTimeline> {
  const root = ctx?.root ?? repoRoot()
  // short-circuit a non-yatsu node on the (short) yatsu walk — the board attaches `evals` to every node, so
  // this is the common case and must stay cheap (a list the size of the few yatsu nodes, not the whole tree).
  const ynode = (ctx?.ynodes ?? yatsuNodes(root)).find((n) => n.id === id)
  if (!ynode) return { node: id, hasYatsu: false, scenarios: [], readings: [], dangling: [] }
  // the governed `code:` files are the freshness CODE axis; read them from the canonical spec loader so a
  // reparent/rename is seen the same way `spex lint` and `spex yatsu eval` see it (joined by directory).
  const specs = ctx?.specs ?? await loadSpecs()
  const codeFiles = specs.find((s) => dirname(s.path) === relative(root, ynode.dir))?.code ?? []
  const idx = ctx?.idx ?? await driftIndex(root)
  const hidx = ctx?.hidx ?? await historyIndex(root)
  const byName = new Map(ynode.scenarios.map((s) => [s.name, s]))   // join each reading to its scenario's expected + code
  // the trunk remark track per scenario ([[remark-teeth]]) — the non-git freshness input, fed to the teeth.
  const tracks = ctx?.remarks ?? loadEvalRemarkTracks()
  const remarksFor = (scenario: string): RemarkTrack['remarks'] => tracks.get(trackKey(id, scenario))?.remarks ?? []
  const threadFor = (scenario: string): Issue | undefined => tracks.get(trackKey(id, scenario))?.thread
  const scenarios: ScenarioInfo[] = ynode.scenarios.map((s) => ({
    name: s.name, expected: s.expected,
    ...(s.tags?.length ? { tags: s.tags } : {}), ...(s.code?.length ? { code: s.code } : {}),
  }))
  const readings: EvalEntry[] = readReadings(ynode.sidecarPath).map((r) => {
    // a scenario's own `code` is its freshness code axis when it declares one; else the whole node's list.
    const sc = byName.get(r.scenario)
    // the teeth feed the WHOLE scenario track against THIS reading — an unresolved (or not-yet-out-run)
    // remark makes it remark-stale (T1). Display attachment (which reading each remark pins to) is a separate
    // read-time overlay below; freshness never depends on that pin.
    const axes = staleAxes(r, sc?.code?.length ? sc.code : codeFiles, ynode.yatsuPath, idx, hidx,
      remarksFor(r.scenario).map((rm) => ({ resolved: !!rm.resolved, resolvedAt: rm.resolvedAt })))
    // the reading's evidence list, each entry resolved to its live blob state; the primary (video-first, else
    // first) drives the scalar compat fields for single-evidence consumers.
    const evidence: EvidenceView[] = evidenceOf(r).map((e) => ({ hash: e.hash, kind: e.kind, state: hasBlob(e.hash) ? 'present' : 'miss' }))
    const primary = evidence.find((e) => e.kind === 'video') ?? evidence[0]
    return {
      scenario: r.scenario,
      expected: byName.get(r.scenario)?.expected ?? '',
      codeSha: r.codeSha,
      ...(evidence.length ? { evidence } : {}),
      blob: primary?.hash ?? null,
      ...(primary ? { blobKind: primary.kind } : {}),
      ...(r.timelineBlob ? { timelineBlob: r.timelineBlob } : {}),
      evaluator: r.evaluator,
      ...(r.verdict ? { verdict: r.verdict } : {}),
      ts: r.ts,
      fresh: axes.length === 0,
      staleAxes: axes,
      blobState: primary ? primary.state : 'none',
      ...(threadFor(r.scenario) ? { thread: threadFor(r.scenario) } : {}),
    }
  })
  readings.reverse()   // newest-first
  // R2 display overlay ([[remark-teeth]]): pin each remark to the reading it JUDGED (targetCodeSha match),
  // else the scenario's latest reading (first in newest-first order) — a dangling target never HIDES the
  // remark. A track whose SCENARIO no reading joins (renamed/deleted) has no reading to attach to, so it
  // becomes a synthetic DANGLING row at node level (directive 5) instead of vanishing — visible, its remarks
  // resolvable/retractable via their refs, and ageing nothing (there is no reading for the teeth to stale).
  const declared = new Set(ynode.scenarios.map((s) => s.name))
  const dangling: DanglingTrack[] = []
  for (const [, track] of tracks) {
    if (track.node !== id || !track.remarks.length) continue
    const rows = readings.filter((r) => r.scenario === track.scenario)
    if (!rows.length) {
      // no reading joins this track. If the scenario is still DECLARED it is just a blind spot (unmeasured),
      // not orphaned — its remarks wait for a reading. Only a scenario that is BOTH gone from yatsu.md AND
      // has no reading is truly dangling (renamed/deleted), and that is the one we surface at node level.
      if (!declared.has(track.scenario)) {
        dangling.push({
          scenario: track.scenario, threadId: track.threadId, thread: track.thread,
          remarks: track.remarks.map((rm) => toRemarkView(rm, track.threadId, true)),
        })
      }
      continue
    }
    const latest = rows[0]
    for (const rm of track.remarks) {
      const target = rows.find((r) => r.codeSha === rm.targetCodeSha)
      const host = target ?? latest
      ;(host.remarks ??= []).push(toRemarkView(rm, track.threadId, !target))
    }
  }
  return { node: id, hasYatsu: true, scenarios, readings, dangling }
}

const HEX64 = /^[0-9a-f]{64}$/

export type BlobResult =
  | { ok: true; bytes: Buffer; mime: string }
  | { ok: false; reason: 'invalid' | 'miss'; message: string }

export function readBlobByHash(hash: string, dir?: string): BlobResult {
  if (!HEX64.test(hash)) return { ok: false, reason: 'invalid', message: 'bad blob hash' }
  const bytes = getBlob(hash, dir)   // undefined dir → the live cache (cache.ts default); a temp dir in tests
  if (!bytes) return { ok: false, reason: 'miss', message: MISS_BLOB }
  return { ok: true, bytes, mime: sniffBlobMime(bytes) }
}

// PNG/JPEG/GIF/WebP cover every screenshot (a manual --image); MP4/WebM cover a recorded clip (--video), so
// the blob route serves it with a playable Content-Type; a transcript (--result) is text, so bytes with no
// NUL and no known header sniff to text/plain; anything else falls back to a generic binary type so it still
// downloads rather than being mislabeled.
function sniffBlobMime(b: Buffer): string {
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  // WebM/Matroska begin with the EBML magic 1A 45 DF A3; disambiguate from a RIFF/WEBP image above.
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm'
  // ISO-BMFF (MP4/MOV): a `ftyp` box type at bytes 4..8, after its 4-byte size.
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4'
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (b.length && !b.includes(0)) return 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}
