import { relative, dirname } from 'node:path'
import { repoRoot, driftIndex, historyIndex, type DriftIndex, type HistoryIndex } from '../../spec-cli/src/git.js'
import { loadSpecs } from '../../spec-cli/src/specs.js'
import { yatsuNodes, type YatsuNode } from './yatsu.js'
import { readReadings, type Verdict } from './sidecar.js'
import { staleAxes, type StaleAxis } from './freshness.js'
import { hasBlob, getBlob, MISS_BLOB } from './cache.js'

export type EvalEntry = {
  scenario: string
  expected: string
  codeSha: string
  blob: string | null
  blobKind?: 'image' | 'transcript'
  evaluator: string
  verdict?: Verdict
  ts: string
  fresh: boolean
  staleAxes: StaleAxis[]
  blobState: 'present' | 'miss' | 'none'
}

export type ScenarioInfo = { name: string; expected: string; code?: string[] }

// `hasYatsu` distinguishes a node that declares no scenarios (no yatsu.md) from one that declares some but
// has no readings yet — the tab says different things for each. `scenarios` is the declared set; `readings`
// is NEWEST-FIRST (the sidecar is append-only oldest→newest; the tab leads with the latest measurement,
// like the history tab).
export type EvalTimeline = {
  node: string
  hasYatsu: boolean
  scenarios: ScenarioInfo[]
  readings: EvalEntry[]
}

export type EvalContext = {
  root: string
  specs: Awaited<ReturnType<typeof loadSpecs>>
  idx: DriftIndex
  hidx: HistoryIndex
  ynodes: YatsuNode[]
}

// build the shared context with ONE yatsu walk, reusing the caller's already-computed specs + the two
// HEAD-keyed git indices (drift for the code axis, history for the rename-safe scenario axis — both warm
// hits, loadSpecs already derived them).
export function evalContext(root: string, specs: Awaited<ReturnType<typeof loadSpecs>>, idx: DriftIndex, hidx: HistoryIndex): EvalContext {
  return { root, specs, idx, hidx, ynodes: yatsuNodes(root) }
}

export async function evalTimeline(id: string, ctx?: EvalContext): Promise<EvalTimeline> {
  const root = ctx?.root ?? repoRoot()
  // short-circuit a non-yatsu node on the (short) yatsu walk — the board attaches `evals` to every node, so
  // this is the common case and must stay cheap (a list the size of the few yatsu nodes, not the whole tree).
  const ynode = (ctx?.ynodes ?? yatsuNodes(root)).find((n) => n.id === id)
  if (!ynode) return { node: id, hasYatsu: false, scenarios: [], readings: [] }
  // the governed `code:` files are the freshness CODE axis; read them from the canonical spec loader so a
  // reparent/rename is seen the same way `spex lint` and `spex yatsu eval` see it (joined by directory).
  const specs = ctx?.specs ?? await loadSpecs()
  const codeFiles = specs.find((s) => dirname(s.path) === relative(root, ynode.dir))?.code ?? []
  const idx = ctx?.idx ?? await driftIndex(root)
  const hidx = ctx?.hidx ?? await historyIndex(root)
  const byName = new Map(ynode.scenarios.map((s) => [s.name, s]))   // join each reading to its scenario's expected + code
  const scenarios: ScenarioInfo[] = ynode.scenarios.map((s) => ({
    name: s.name, expected: s.expected, ...(s.code?.length ? { code: s.code } : {}),
  }))
  const readings: EvalEntry[] = readReadings(ynode.sidecarPath).map((r) => {
    // a scenario's own `code` is its freshness code axis when it declares one; else the whole node's list.
    const sc = byName.get(r.scenario)
    const axes = staleAxes(r, sc?.code?.length ? sc.code : codeFiles, ynode.yatsuPath, idx, hidx)
    return {
      scenario: r.scenario,
      expected: byName.get(r.scenario)?.expected ?? '',
      codeSha: r.codeSha,
      blob: r.blob,
      ...(r.blobKind ? { blobKind: r.blobKind } : {}),
      evaluator: r.evaluator,
      ...(r.verdict ? { verdict: r.verdict } : {}),
      ts: r.ts,
      fresh: axes.length === 0,
      staleAxes: axes,
      blobState: r.blob == null ? 'none' : hasBlob(r.blob) ? 'present' : 'miss',
    }
  })
  readings.reverse()
  return { node: id, hasYatsu: true, scenarios, readings }
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

// PNG/JPEG/GIF/WebP cover every screenshot (a manual --image); a transcript (--result) is text, so bytes
// with no NUL and no image header sniff to text/plain; anything else falls back to a generic binary type so
// it still downloads rather than being mislabeled.
function sniffBlobMime(b: Buffer): string {
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (b.length && !b.includes(0)) return 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}
