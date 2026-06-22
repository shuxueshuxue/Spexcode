import { readFileSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { repoRoot, headSha, driftIndex, stagedFiles, git } from '../../spec-cli/src/git.js'
import { loadSpecs } from '../../spec-cli/src/specs.js'
import { yatsuNodes, type YatsuNode, type Scenario } from './yatsu.js'
import { readReadings, appendReading, latestPerScenario, type Reading } from './sidecar.js'
import { staleAxes } from './freshness.js'
import { driverFor, evaluatorTag } from './drivers.js'
import { putBlob, listBlobs, gc, isStrayBlob } from './cache.js'

// @@@ yatsu cli - the eval/loss engine on the real `spex` surface (the [[forge-cli]] shape: spec-cli/cli.ts
// carries only a thin `yatsu` route delegating here; all logic lives in this package). Three verbs over the
// readings sidecar — scan (status), eval (re-read), clean (GC the pixel cache) — plus a check-staged
// backstop the pre-commit hook shims to. Freshness is derived live from git, never from stored hashes.

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const has = (args: string[], name: string) => args.includes(`--${name}`)
const positional = (args: string[]) => args.find((a) => !a.startsWith('--'))

// @@@ EvalNode - a yatsu node joined with the governed `code:` files of its spec.md (the code freshness
// axis). The code list is read from the canonical spec loader so reparents/renames are handled the same
// way lint sees them; we join by the node's directory (not just id) to be unambiguous.
type EvalNode = YatsuNode & { codeFiles: string[] }

async function gatherNodes(root: string): Promise<EvalNode[]> {
  const specs = await loadSpecs()
  const codeByDir = new Map<string, string[]>()
  for (const s of specs) codeByDir.set(dirname(s.path), s.code)   // s.path = repo-relative spec.md path
  return yatsuNodes(root).map((n) => ({ ...n, codeFiles: codeByDir.get(relative(root, n.dir)) ?? [] }))
}

// resolve `.` → the node this worktree works on: the `.session` node line, else the `node/<id>` branch.
function currentNodeId(root: string): string | null {
  const sf = join(root, '.session')
  if (existsSync(sf)) {
    for (const line of readFileSync(sf, 'utf8').split('\n')) {
      const m = line.match(/^\s*node:\s*(\S+)/)
      if (m) return m[1]
    }
  }
  try {
    const branch = git(['-C', root, 'symbolic-ref', '--short', 'HEAD']).trim()
    if (branch.startsWith('node/')) return branch.slice('node/'.length)
  } catch { /* detached / no branch */ }
  return null
}

// @@@ scan - status: nodes holding a stale reading, mirroring `spex lint`'s code-drift output (the same
// `•`/`✗` glyph + one line per finding). Read-only; exits 0 (a status report, like drift's advisory warn).
// The forge `needs-yatsu-eval` half of the spec's scan is a separate node — not part of the core.
async function scan(): Promise<number> {
  const root = repoRoot()
  const idx = await driftIndex(root)
  const nodes = await gatherNodes(root)
  let staleNodes = 0, staleReadings = 0
  for (const n of nodes) {
    const byName = new Map(n.scenarios.map((s) => [s.name, s]))
    const stale: { r: Reading; axes: string[] }[] = []
    for (const r of readReadings(n.sidecarPath)) {
      const axes = staleAxes(r, byName.get(r.scenario), n.codeFiles, n.yatsuPath, idx)
      if (axes.length) stale.push({ r, axes })
    }
    if (!stale.length) continue
    staleNodes++; staleReadings += stale.length
    for (const { r, axes } of stale)
      console.error(`  • yatsu-drift: '${n.id}' scenario '${r.scenario}' is stale (${axes.join(', ')} moved since ${r.codeSha.slice(0, 7)}) — re-read with \`spex yatsu eval ${n.id}\``)
  }
  console.error(`spex yatsu scan: ${staleNodes} node(s) holding a stale reading, ${staleReadings} stale reading(s)`)
  return 0
}

// @@@ eval - re-read scenarios into the sidecar, INCREMENTAL + IDEMPOTENT: a scenario is re-read only when
// its latest reading is stale (or absent), so a no-change re-run records nothing; `--force` re-reads all
// (a result suspected flaky). `.` = the current node, a bare id = that node, no arg = sweep every yatsu node.
// `--image <path>` hands the (manual) driver a captured image to store as the reading's blob.
async function evalCmd(args: string[]): Promise<number> {
  const root = repoRoot()
  const force = has(args, 'force')
  const image = flag(args, 'image')
  const sel = positional(args)
  const idx = await driftIndex(root)
  let nodes = await gatherNodes(root)
  if (sel === '.') {
    const cur = currentNodeId(root)
    if (!cur) { console.error('spex yatsu eval .: no current node (no .session/node-branch here) — name a node or sweep all'); return 2 }
    nodes = nodes.filter((n) => n.id === cur)
    if (!nodes.length) { console.error(`spex yatsu eval .: current node '${cur}' has no yatsu.md (declare scenarios first)`); return 1 }
  } else if (sel) {
    nodes = nodes.filter((n) => n.id === sel)
    if (!nodes.length) { console.error(`spex yatsu eval: no yatsu node '${sel}' (a node needs a yatsu.md)`); return 1 }
  }
  if (!nodes.length) { console.log('spex yatsu eval: no yatsu nodes to evaluate'); return 0 }
  const codeSha = headSha(root)   // the freshness anchor stamped on every reading taken now
  let produced = 0, fresh = 0, skipped = 0
  for (const n of nodes) {
    const latest = latestPerScenario(readReadings(n.sidecarPath))
    for (const sc of n.scenarios) {
      const drv = driverFor(sc.driver)
      if (!drv) { console.error(`  ! '${n.id}' scenario '${sc.name}': unknown driver '${sc.driver}' — skipped (no producer registered)`); skipped++; continue }
      const prev = latest.get(sc.name)
      const stale = !prev || staleAxes(prev, sc, n.codeFiles, n.yatsuPath, idx).length > 0
      if (!force && !stale) { fresh++; continue }
      const bytes = await drv.capture(sc, { image })
      const blob = bytes ? putBlob(bytes) : null
      const reading: Reading = { scenario: sc.name, codeSha, blob, evaluator: evaluatorTag(drv), ts: new Date().toISOString() }
      appendReading(n.sidecarPath, reading)
      produced++
      console.log(`  ✓ '${n.id}' scenario '${sc.name}' → reading @ ${codeSha.slice(0, 7)} [${reading.evaluator}]${blob ? ` blob ${blob.slice(0, 12)}…` : ' (no image)'}`)
    }
  }
  console.log(`spex yatsu eval: ${produced} reading(s) recorded, ${fresh} fresh (skipped)${skipped ? `, ${skipped} no-driver` : ''}`)
  return 0
}

// @@@ clean - GC the pixel cache. Default: drop blobs referenced by NO reading record. `--keep-latest`:
// keep only the latest reading's blob per scenario (drop superseded captures too). `--all`: drop every
// blob. Records are untouched — a dropped blob just renders as the MISS sentinel until re-evaluated.
async function clean(args: string[]): Promise<number> {
  const root = repoRoot()
  const all = has(args, 'all')
  const keepLatest = has(args, 'keep-latest')
  const referenced = new Set<string>()
  if (!all) {
    for (const n of await gatherNodes(root)) {
      const readings = readReadings(n.sidecarPath)
      const keep = keepLatest ? [...latestPerScenario(readings).values()] : readings
      for (const r of keep) if (r.blob) referenced.add(r.blob)
    }
  }
  const before = listBlobs().length
  const removed = gc(referenced)
  const mode = all ? 'all' : keepLatest ? 'keep-latest' : 'unreferenced'
  console.log(`spex yatsu clean: removed ${removed.length} blob(s), kept ${before - removed.length} (${mode})`)
  return 0
}

// @@@ check-staged - the pre-commit backstop. A pixel blob lives in the shared git common dir (outside the
// tree), so the only way one reaches the index is a stray copy into the worktree; reject it rather than let
// binary pixels into git history. The hook shims to this (`spex yatsu check-staged`), like the lint shim.
function checkStaged(): number {
  const offenders = stagedFiles(repoRoot()).filter(isStrayBlob)
  if (!offenders.length) return 0
  console.error('✗ SpexCode yatsu: stray pixel blob(s) staged — blobs live in the shared git common dir, never in the tree:')
  for (const o of offenders) console.error(`    ${o}`)
  console.error('  Unstage them (git rm --cached <path>); a reading references its blob by hash, it never commits the bytes.')
  return 1
}

// @@@ runYatsu - the package's single entrypoint, called by cli.ts's thin `yatsu` route with the arg slice
// after `yatsu`. Routes to a verb and returns the process exit code (the route just exits on it).
export async function runYatsu(args: string[]): Promise<number> {
  const sub = args[0]
  if (sub === 'scan') return scan()
  if (sub === 'eval') return evalCmd(args.slice(1))
  if (sub === 'clean') return clean(args.slice(1))
  if (sub === 'check-staged') return checkStaged()
  console.error('spex yatsu: scan | eval [.|<node>] [--force] [--image <path>] | clean [--keep-latest|--all]')
  return 2
}
