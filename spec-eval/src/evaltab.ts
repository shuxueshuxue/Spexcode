import { relative, dirname } from 'node:path'
import { repoRoot, driftIndex, historyIndex, commitReachable, type DriftIndex, type HistoryIndex } from '../../spec-cli/src/git.js'
import { loadSpecs } from '../../spec-cli/src/specs.js'
import { loadEvalRemarkTracks, trackKey, type RemarkTrack, type Issue, type Reply } from '../../spec-cli/src/issues.js'
import { evalNodes, scenarioCodeAxis, type EvalNode, type ScenarioTestReference } from './scenarios.js'
import { readSidecar, applyRetractions, evidenceOf, isJsonBlob, humanOkFor, type Verdict, type EvidenceKind, type Retraction, type Reading, type HumanOk } from './sidecar.js'
import type { RelationEntry } from '../../spec-cli/src/anchors.js'
import { staleAxes, codeDrift, contentProbeFor, anchorProbeFor, type StaleAxis } from './freshness.js'
import { scenarioIndex, type ScenarioIndex } from './scenariofresh.js'
import { hasBlob, getBlob, MISS_BLOB } from './cache.js'

export type EvidenceView = { hash: string; kind: EvidenceKind; state: 'present' | 'miss' }

export type RemarkView = {
  rid: string
  ref: string             // `<thread-id>#<rid>` — the address `spex remark resolve`/`spex remark retract` take
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
  evidence?: EvidenceView[]
  blob: string | null
  blobKind?: EvidenceKind
  timelineBlob?: string
  evaluator?: string
  by?: string
  verdict?: Verdict
  ts: string
  fresh: boolean
  staleAxes: StaleAxis[]
  blobState: 'present' | 'miss' | 'none'
  codeDrift?: { file: string; behind: number }[]
  remarks?: RemarkView[]
  thread?: Issue
  humanOk?: { by: string; ts: string }
}

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

export type DanglingTrack = { scenario: string; threadId: string; thread: Issue; remarks: RemarkView[] }

export type ScenarioInfo = { name: string; expected: string; tags?: string[]; test?: ScenarioTestReference; code?: string[] }

export type EvalTimeline = {
  node: string
  hasEvalFile: boolean
  scenarios: ScenarioInfo[]
  readings: EvalEntry[]
  retractions: Retraction[]
  dangling: DanglingTrack[]
}

export type EvalContext = {
  root: string
  specs: Awaited<ReturnType<typeof loadSpecs>>
  idx: DriftIndex
  hidx: HistoryIndex
  scidx: ScenarioIndex
  ynodes: EvalNode[]
  remarks: Map<string, RemarkTrack>
}

export async function evalContext(
  root: string,
  specs: Awaited<ReturnType<typeof loadSpecs>>,
  idx: DriftIndex,
  hidx: HistoryIndex,
  remarks?: Map<string, RemarkTrack>,
  ynodes?: EvalNode[],
): Promise<EvalContext> {
  const nodes = ynodes ?? evalNodes(root)
  const scidx = await scenarioIndex(root, nodes.map((n) => n.evalPath))
  return { root, specs, idx, hidx, scidx, ynodes: nodes, remarks: remarks ?? loadEvalRemarkTracks() }
}

// @@@ one read, one batch - the freshness engine's Git work is immutable-object work, so it is owned ONCE
// per read rather than once per reading. evalTimelines is the plural the graph build actually wants: it
// plans every node's rows first (pure fs + in-memory projection), primes the content and anchor probes with
// the WHOLE demand set, then assembles. Singular evalTimeline is the one-id case of the same path.
export async function evalTimelines(ids: readonly string[], ctx?: EvalContext): Promise<EvalTimeline[]> {
  const root = ctx?.root ?? repoRoot()
  const ynodes = ctx?.ynodes ?? evalNodes(root)
  const specs = ctx?.specs ?? await loadSpecs()
  const idx = ctx?.idx ?? await driftIndex(root)
  const hidx = ctx?.hidx ?? await historyIndex(root)
  const scidx = ctx?.scidx ?? await scenarioIndex(root, ynodes.map((n) => n.evalPath))
  const tracks = ctx?.remarks ?? loadEvalRemarkTracks()
  const probe = contentProbeFor(root)
  const anchors = anchorProbeFor(root, idx)

  type Row = { reading: Reading; axis: ReturnType<typeof scenarioCodeAxis> }
  type Plan = { id: string; ynode?: EvalNode; codeEntries: RelationEntry[]; rows: Row[]; retractions: Retraction[]; oks: HumanOk[] }
  const plans: Plan[] = ids.map((id) => {
    const ynode = ynodes.find((n) => n.id === id)
    if (!ynode) return { id, codeEntries: [], rows: [], retractions: [], oks: [] }
    const codeEntries = specs.find((s) => dirname(s.path) === relative(root, ynode.dir))?.codeEntries ?? []
    const byName = new Map(ynode.scenarios.map((s) => [s.name, s]))
    const { readings, retractions, oks } = readSidecar(ynode.sidecarPath)
    const rows = applyRetractions(readings, retractions).map((reading) => ({
      reading, axis: scenarioCodeAxis(byName.get(reading.scenario)?.code, codeEntries),
    }))
    return { id, ynode, codeEntries, rows, retractions, oks }
  })

  // An off-history anchor is the only reading that needs a content verdict; those primes serialize inside the
  // probe per anchor, so issuing them together lets one anchor's paths union into one child instead of N.
  await Promise.all(plans.flatMap((plan) => plan.ynode
    ? plan.rows.filter((row) => !commitReachable(idx, row.reading.codeSha))
        .map((row) => probe.prime?.(row.reading.codeSha, row.axis.paths, plan.ynode!.evalPath))
    : []))
  await anchors.prime?.(plans.flatMap((plan) => plan.rows.map((row) => ({ sinceSha: row.reading.codeSha, entries: row.axis.entries }))))

  return plans.map((plan) => assembleTimeline(plan.id, plan.ynode, plan.rows, plan.retractions, plan.oks, {
    idx, scidx, tracks, probe, anchors,
  }))
}

export async function evalTimeline(id: string, ctx?: EvalContext): Promise<EvalTimeline> {
  return (await evalTimelines([id], ctx))[0]
}

type AssembleDeps = {
  idx: DriftIndex; scidx: ScenarioIndex; tracks: Map<string, RemarkTrack>
  probe: ReturnType<typeof contentProbeFor>; anchors: ReturnType<typeof anchorProbeFor>
}
function assembleTimeline(
  id: string,
  ynode: EvalNode | undefined,
  rows: { reading: Reading; axis: ReturnType<typeof scenarioCodeAxis> }[],
  retractions: Retraction[],
  oks: HumanOk[],
  { idx, scidx, tracks, probe, anchors }: AssembleDeps,
): EvalTimeline {
  if (!ynode) return { node: id, hasEvalFile: false, scenarios: [], readings: [], retractions: [], dangling: [] }
  const byName = new Map(ynode.scenarios.map((s) => [s.name, s]))
  const remarksFor = (scenario: string): RemarkTrack['remarks'] => tracks.get(trackKey(id, scenario))?.remarks ?? []
  const threadFor = (scenario: string): Issue | undefined => tracks.get(trackKey(id, scenario))?.thread
  const scenarios: ScenarioInfo[] = ynode.scenarios.map((s) => ({
    name: s.name, expected: s.expected,
    ...(s.tags?.length ? { tags: s.tags } : {}), ...(s.test ? { test: s.test } : {}),
    ...(s.code?.length ? { code: s.code } : {}),
  }))
  const readings: EvalEntry[] = []
  for (const { reading: r, axis } of rows) {
    const sc = byName.get(r.scenario)
    const axes = staleAxes(r, axis.entries, ynode.evalPath, idx, scidx,
      remarksFor(r.scenario).map((rm) => ({ resolved: !!rm.resolved, resolvedAt: rm.resolvedAt })), probe, sc, anchors)
    const drift = axes.includes('code') ? codeDrift(idx, r.codeSha, axis.entries, probe) : []
    const evidence: EvidenceView[] = evidenceOf(r).map((e) => ({ hash: e.hash, kind: e.kind, state: hasBlob(e.hash) ? 'present' : 'miss' }))
    const primary = evidence.find((e) => e.kind === 'video') ?? evidence[0]
    const okRow = humanOkFor(oks, r.scenario, r.ts)
    readings.push({
      scenario: r.scenario,
      expected: byName.get(r.scenario)?.expected ?? '',
      codeSha: r.codeSha,
      ...(evidence.length ? { evidence } : {}),
      blob: primary?.hash ?? null,
      ...(primary ? { blobKind: primary.kind } : {}),
      ...(r.timelineBlob ? { timelineBlob: r.timelineBlob } : {}),
      ...(r.evaluator ? { evaluator: r.evaluator } : {}),
      ...(r.by ? { by: r.by } : {}),
      ...(r.verdict ? { verdict: r.verdict } : {}),
      ts: r.ts,
      fresh: axes.length === 0,
      staleAxes: axes,
      ...(drift.length ? { codeDrift: drift } : {}),
      blobState: primary ? primary.state : 'none',
      ...(threadFor(r.scenario) ? { thread: threadFor(r.scenario) } : {}),
      ...(okRow ? { humanOk: { by: okRow.by, ts: okRow.ts } } : {}),
    })
  }
  readings.reverse()
  const declared = new Set(ynode.scenarios.map((s) => s.name))
  const dangling: DanglingTrack[] = []
  for (const [, track] of tracks) {
    if (track.node !== id || !track.remarks.length) continue
    const hosts = readings.filter((r) => r.scenario === track.scenario)
    if (!hosts.length) {
      if (!declared.has(track.scenario)) {
        dangling.push({
          scenario: track.scenario, threadId: track.threadId, thread: track.thread,
          remarks: track.remarks.map((rm) => toRemarkView(rm, track.threadId, true)),
        })
      }
      continue
    }
    const latest = hosts[0]
    for (const rm of track.remarks) {
      const target = hosts.find((r) => r.codeSha === rm.targetCodeSha)
      const host = target ?? latest
      ;(host.remarks ??= []).push(toRemarkView(rm, track.threadId, !target))
    }
  }
  return { node: id, hasEvalFile: true, scenarios, readings, retractions: [...retractions].reverse(), dangling }
}

const HEX64 = /^[0-9a-f]{64}$/

export type BlobResult =
  | { ok: true; bytes: Buffer; mime: string }
  | { ok: false; reason: 'invalid' | 'miss'; message: string }

export function readBlobByHash(hash: string, dir?: string): BlobResult {
  if (!HEX64.test(hash)) return { ok: false, reason: 'invalid', message: 'bad evidence hash' }
  const bytes = getBlob(hash, dir)   // undefined dir → the live cache (cache.ts default); a temp dir in tests
  if (!bytes) return { ok: false, reason: 'miss', message: MISS_BLOB }
  return { ok: true, bytes, mime: sniffBlobMime(bytes) }
}

export function sniffBlobMime(b: Buffer): string {
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  // WebM/Matroska begin with the EBML magic 1A 45 DF A3; disambiguate from a RIFF/WEBP image above.
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm'
  // ISO-BMFF (MP4/MOV): a `ftyp` box type at bytes 4..8, after its 4-byte size.
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4'
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (b.length && !b.includes(0)) return isJsonBlob(b) ? 'application/json' : 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}
