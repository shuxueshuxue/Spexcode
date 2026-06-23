import { relative, dirname } from 'node:path'
import { repoRoot, driftIndex, type DriftIndex } from '../../spec-cli/src/git.js'
import { loadSpecs } from '../../spec-cli/src/specs.js'
import { yatsuNodes, type YatsuNode } from './yatsu.js'
import { readReadings } from './sidecar.js'
import { staleAxes, type StaleAxis } from './freshness.js'
import { getBlob, hasBlob, MISS_BLOB } from './cache.js'

// @@@ eval tab read-side - the dashboard's window onto the eval/loss engine, the READ half of the surface
// `spex yatsu scan|eval` writes. It serves the [[spec-yatsu]] "Evidence — one timeline, two sources"
// contract for the eval tab: a node's chronological evaluation timeline (the readings sidecar joined with a
// LIVE freshness flag, the same git-derived staleness `scan` reports) and the captured pixels behind each
// reading (the content-addressed blob, or a clear MISS signal when the record outlived its bytes). LOCAL
// readings only; the forge issue-events source is a future sibling ([[freshness]] reconcile) — see the spec.
//
// The timeline now RIDES THE BOARD: buildBoard folds each node's evalTimeline onto its board node (the
// `evals` field) so the dashboard eval tab reads the single /api/board poll like every other pane, never a
// separate per-node fetch. To keep that whole-board attach fast, evalTimeline takes an optional EvalContext
// of the specs + driftIndex the board ALREADY computed (so they're not re-derived per node) plus one shared
// yatsu walk; the standalone /api/specs/:id/evals route omits it and derives all three itself for one id.

// @@@ EvalEntry - one reading rendered for the tab. The sidecar fields verbatim (scenario/codeSha/blob/
// evaluator/ts) PLUS what only a live read can know: `fresh` + which `staleAxes` moved (the freshness
// badge), and `blobState` so the UI knows whether to offer an image, show MISS, or note a pixel-less read.
export type EvalEntry = {
  scenario: string
  codeSha: string
  blob: string | null
  evaluator: string
  ts: string
  fresh: boolean
  staleAxes: StaleAxis[]
  blobState: 'present' | 'miss' | 'none'
}

// `hasYatsu` distinguishes a node that declares no scenarios (no yatsu.md) from one that declares some but
// has no readings yet — the tab says different things for each. `readings` is NEWEST-FIRST (the sidecar is
// append-only oldest→newest; the tab leads with the latest evaluation, like the history tab).
export type EvalTimeline = {
  node: string
  hasYatsu: boolean
  readings: EvalEntry[]
}

// @@@ EvalContext - the read-context a WHOLE-BOARD attach computes ONCE (buildBoard) so the eval timeline
// rides the single board poll instead of a per-node fetch: the yatsu-node walk plus the specs + driftIndex
// the board already derived. evalTimeline reuses these for every node — only the few yatsu nodes then touch
// their sidecar; the rest short-circuit on the (short) ynodes list — so the board poll stays fast.
export type EvalContext = {
  root: string
  specs: Awaited<ReturnType<typeof loadSpecs>>
  idx: DriftIndex
  ynodes: YatsuNode[]
}

// build the shared context with ONE yatsu walk, reusing the caller's already-computed specs + driftIndex.
export function evalContext(root: string, specs: Awaited<ReturnType<typeof loadSpecs>>, idx: DriftIndex): EvalContext {
  return { root, specs, idx, ynodes: yatsuNodes(root) }
}

export async function evalTimeline(id: string, ctx?: EvalContext): Promise<EvalTimeline> {
  const root = ctx?.root ?? repoRoot()
  // short-circuit a non-yatsu node on the (short) yatsu walk — the board attaches `evals` to every node, so
  // this is the common case and must stay cheap (a list the size of the few yatsu nodes, not the whole tree).
  const ynode = (ctx?.ynodes ?? yatsuNodes(root)).find((n) => n.id === id)
  if (!ynode) return { node: id, hasYatsu: false, readings: [] }
  // the governed `code:` files are the freshness CODE axis; read them from the canonical spec loader so a
  // reparent/rename is seen the same way `spex lint` and `spex yatsu eval` see it (joined by directory).
  const specs = ctx?.specs ?? await loadSpecs()
  const codeFiles = specs.find((s) => dirname(s.path) === relative(root, ynode.dir))?.code ?? []
  const idx = ctx?.idx ?? await driftIndex(root)
  const byName = new Map(ynode.scenarios.map((s) => [s.name, s]))
  const readings: EvalEntry[] = readReadings(ynode.sidecarPath).map((r) => {
    const axes = staleAxes(r, byName.get(r.scenario), codeFiles, ynode.yatsuPath, idx)
    return {
      scenario: r.scenario,
      codeSha: r.codeSha,
      blob: r.blob,
      evaluator: r.evaluator,
      ts: r.ts,
      fresh: axes.length === 0,
      staleAxes: axes,
      blobState: r.blob == null ? 'none' : hasBlob(r.blob) ? 'present' : 'miss',
    }
  })
  readings.reverse()
  return { node: id, hasYatsu: true, readings }
}

// @@@ blob serving - resolve a reading's pixels by content hash from the shared common-dir cache (the only
// reader's view of the bytes; they never enter git). Three outcomes the route maps to HTTP: a malformed hash
// (`invalid`), a record whose bytes are gone (`miss` — the MISS_BLOB sentinel, surfaced as "miss original
// file"), or the bytes with a MIME sniffed from the magic number (the cache stores raw bytes, no type).
const HEX64 = /^[0-9a-f]{64}$/

export type BlobResult =
  | { ok: true; bytes: Buffer; mime: string }
  | { ok: false; reason: 'invalid' | 'miss'; message: string }

export function readBlobByHash(hash: string, dir?: string): BlobResult {
  if (!HEX64.test(hash)) return { ok: false, reason: 'invalid', message: 'bad blob hash' }
  const bytes = getBlob(hash, dir)   // undefined dir → the live cache (cache.ts default); a temp dir in tests
  if (!bytes) return { ok: false, reason: 'miss', message: MISS_BLOB }
  return { ok: true, bytes, mime: sniffImageMime(bytes) }
}

// PNG/JPEG/GIF/WebP cover every driver capture (and a manual --image); anything else falls back to a
// generic binary type so a non-image blob still downloads rather than being mislabeled.
function sniffImageMime(b: Buffer): string {
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return 'application/octet-stream'
}
