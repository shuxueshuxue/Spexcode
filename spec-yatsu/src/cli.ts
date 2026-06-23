import { readFileSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { repoRoot, headSha, driftIndex, stagedFiles, git } from '../../spec-cli/src/git.js'
import { loadSpecs } from '../../spec-cli/src/specs.js'
import { yatsuNodes, type YatsuNode } from './yatsu.js'
import { readReadings, appendReading, latestPerScenario, type Reading, type Verdict } from './sidecar.js'
import { staleAxes } from './freshness.js'
import { evaluatorTag } from './evaluator.js'
import { putBlob, listBlobs, gc, isStrayBlob } from './cache.js'
import { evalTimeline, type EvalTimeline } from './evaltab.js'

// @@@ yatsu cli - the eval/loss SCOREBOARD on the real `spex` surface (the [[forge-cli]] shape: spec-cli/
// cli.ts carries only a thin `yatsu` route delegating here; all logic lives in this package). yatsu KEEPS
// SCORE and EXECUTES NOTHING — four verbs over the readings sidecar: scan (which scores are stale), eval
// (FILE the measurement the agent already took), show (read a node's scores), clean (GC the evidence
// cache) — plus a check-staged backstop the pre-commit hook shims to. Freshness is derived live from git.

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

// @@@ scan - status: which SCORES are stale or missing — the loss signal's blind spots — mirroring `spex
// lint`'s code-drift output (the `•` glyph + one line per finding). A "score" is a scenario's LATEST
// reading, so scan reports exactly the (node, scenario) pairs `spex yatsu eval` would (re)measure: a
// scenario whose latest reading went stale (a governed code file, its scenario, or the evaluator moved
// since its codeSha), OR one with no reading at all (missing). Read-only; exits 0 (a status report, like
// drift's advisory warn) — the proactive Stop gate ([[yatsu-proactive]]) reads these finding lines, never
// the exit code. The forge `needs-yatsu-eval` half of the spec's scan is a separate node — not the core's.
async function scan(): Promise<number> {
  const root = repoRoot()
  const idx = await driftIndex(root)
  const nodes = await gatherNodes(root)
  let flaggedNodes = 0, staleScores = 0, missingScores = 0
  for (const n of nodes) {
    const latest = latestPerScenario(readReadings(n.sidecarPath))
    const findings: string[] = []
    for (const sc of n.scenarios) {
      const r = latest.get(sc.name)
      if (!r) {
        missingScores++
        findings.push(`  • yatsu-missing: '${n.id}' scenario '${sc.name}' has no reading yet — measure with \`spex yatsu eval ${n.id}\``)
        continue
      }
      const axes = staleAxes(r, n.codeFiles, n.yatsuPath, idx)
      if (axes.length) {
        staleScores++
        findings.push(`  • yatsu-drift: '${n.id}' scenario '${sc.name}' is stale (${axes.join(', ')} moved since ${r.codeSha.slice(0, 7)}) — re-measure with \`spex yatsu eval ${n.id}\``)
      }
    }
    if (!findings.length) continue
    flaggedNodes++
    for (const f of findings) console.error(f)
  }
  console.error(`spex yatsu scan: ${flaggedNodes} node(s) with a stale or missing score (${staleScores} stale, ${missingScores} missing)`)
  return 0
}

// @@@ eval - FILE the measurement the agent ALREADY took; yatsu RUNS NOTHING (no screenshot, no test, no
// browser). It appends ONE reading for ONE scenario: the evidence the agent captured (`--image` a
// screenshot OR `--result` a transcript, content-addressed the same way — `--result -` reads stdin) and
// the verdict it reached (`--pass` | `--fail` | `--note <how far off>`). `.` / no arg = the current node,
// a bare id = that node. `--scenario <name>` picks which scenario; optional when the node declares one.
async function evalCmd(args: string[]): Promise<number> {
  const root = repoRoot()
  const sel = positional(args)
  const id = !sel || sel === '.' ? currentNodeId(root) : sel
  if (!id) { console.error('spex yatsu eval .: no current node (no .session/node-branch here) — name a node'); return 2 }
  const node = (await gatherNodes(root)).find((n) => n.id === id)
  if (!node) { console.error(`spex yatsu eval: no yatsu node '${id}' (a node needs a yatsu.md)`); return 1 }
  if (!node.scenarios.length) { console.error(`spex yatsu eval: '${id}' declares no scenarios in its yatsu.md`); return 1 }

  // which scenario this measurement is OF: --scenario, or the sole scenario when there is exactly one.
  const names = node.scenarios.map((s) => s.name)
  const scName = flag(args, 'scenario')
  let scenario = scName ? node.scenarios.find((s) => s.name === scName) : node.scenarios.length === 1 ? node.scenarios[0] : undefined
  if (!scenario) {
    const why = scName ? `has no scenario '${scName}'` : `declares ${node.scenarios.length} scenarios — name one with --scenario <name>`
    console.error(`spex yatsu eval: '${id}' ${why} — declared: ${names.join(', ')}`)
    return 1
  }

  // the verdict the agent reached (required — a measurement without one is the legacy shape, not a filing).
  const verdict = parseVerdict(args)
  if (!verdict) { console.error('spex yatsu eval: a verdict is required — one of --pass | --fail | --note <text>'); return 2 }

  // the evidence the agent captured (optional; --image XOR --result). The bytes go to the content-addressed
  // cache exactly the same whether image or transcript; only `blobKind` records which they are.
  const image = flag(args, 'image')
  const result = flag(args, 'result')
  if (image !== undefined && result !== undefined) { console.error('spex yatsu eval: pass at most one of --image / --result'); return 2 }
  let blob: string | null = null
  let blobKind: 'image' | 'transcript' | undefined
  if (image !== undefined) { blob = putBlob(readFileSync(image)); blobKind = 'image' }
  else if (result !== undefined) { blob = putBlob(readFileSync(result === '-' ? 0 : result)); blobKind = 'transcript' }

  const reading: Reading = {
    scenario: scenario.name,
    codeSha: headSha(root),
    blob,
    ...(blobKind ? { blobKind } : {}),
    evaluator: evaluatorTag(),
    verdict,
    ts: new Date().toISOString(),
  }
  appendReading(node.sidecarPath, reading)
  const ev = blobKind === 'transcript' ? `transcript ${blob!.slice(0, 12)}…` : blobKind === 'image' ? `image ${blob!.slice(0, 12)}…` : 'no evidence'
  console.log(`  ✓ '${id}' scenario '${scenario.name}' → ${verdictText(verdict)} @ ${reading.codeSha.slice(0, 7)} [${reading.evaluator}] (${ev})`)
  console.log(`spex yatsu eval: 1 measurement filed`)
  return 0
}

// the verdict from the flags: exactly one of --pass / --fail / --note <text> (precedence pass > fail > note).
function parseVerdict(args: string[]): Verdict | null {
  if (has(args, 'pass')) return { status: 'pass' }
  if (has(args, 'fail')) return { status: 'fail' }
  const note = flag(args, 'note')
  if (note !== undefined) return { status: 'note', note }
  return null
}

// @@@ clean - GC the evidence cache. Default: drop blobs referenced by NO reading record. `--keep-latest`:
// keep only the latest reading's blob per scenario (drop superseded captures too). `--all`: drop every
// blob. Records are untouched — a dropped blob just renders as the MISS sentinel until re-measured.
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

// @@@ check-staged - the pre-commit backstop. An evidence blob lives in the shared git common dir (outside
// the tree), so the only way one reaches the index is a stray copy into the worktree; reject it rather than
// let binary pixels into git history. The hook shims to this (`spex yatsu check-staged`), like the lint shim.
function checkStaged(): number {
  const offenders = stagedFiles(repoRoot()).filter(isStrayBlob)
  if (!offenders.length) return 0
  console.error('✗ SpexCode yatsu: stray evidence blob(s) staged — blobs live in the shared git common dir, never in the tree:')
  for (const o of offenders) console.error(`    ${o}`)
  console.error('  Unstage them (git rm --cached <path>); a reading references its blob by hash, it never commits the bytes.')
  return 1
}

// @@@ show - the CLI FACE of the eval timeline, the terminal twin of the dashboard's eval tab. Both read
// ONE engine: the dashboard folds evalTimeline onto the board, this verb calls the same evalTimeline for one
// node — exactly the `spex board` / `/api/board` byte-identical pattern (both call buildBoard). It's a thin
// wrapper: resolve a single node, hand it to evalTimeline with NO ctx (the standalone path that derives its
// own specs + driftIndex for one id, like the /api/specs/:id/evals route), then render. No timeline logic here.
async function show(args: string[]): Promise<number> {
  const root = repoRoot()
  const sel = positional(args)
  const id = !sel || sel === '.' ? currentNodeId(root) : sel
  if (!id) { console.error('spex yatsu show .: no current node (no .session/node-branch here) — name a node'); return 2 }
  const tl = await evalTimeline(id)   // no ctx → evalTimeline derives specs + driftIndex itself for this one id
  if (has(args, 'json')) { console.log(JSON.stringify(tl, null, 2)); return 0 }
  console.log(formatTimeline(tl))
  return 0
}

// the verdict as a short tag for the terminal: ✓ pass / ✗ fail / ≈ note: <text>, or `legacy` for a reading
// taken before verdicts existed.
function verdictText(v: Verdict | undefined): string {
  if (!v) return 'legacy'
  if (v.status === 'pass') return '✓ pass'
  if (v.status === 'fail') return '✗ fail'
  return `≈ note: ${v.note ?? ''}`
}

// @@@ formatTimeline - the human rendering of an EvalTimeline (the SAME shape `--json` emits verbatim and the
// dashboard rides on the board). NEWEST-FIRST, one row per reading: the VERDICT (the loss the agent
// measured), the freshness badge in the board's code-drift vocabulary (✓ current / ⚠ stale, naming the moved
// axes), the scenario, evaluator, short codeSha, the evidence state (image / transcript / miss / none), and
// ts; the scenario's `expected` (what zero loss is) on a second indented line. The two empty states stay
// distinct by hasYatsu, the way the eval tab keeps them apart.
export function formatTimeline(tl: EvalTimeline): string {
  if (!tl.hasYatsu) return `spex yatsu show: '${tl.node}' declares no scenarios (no yatsu.md)`
  if (!tl.readings.length) return `spex yatsu show: '${tl.node}' has scenarios but no reading yet — run \`spex yatsu eval ${tl.node}\``
  const w = Math.max(...tl.readings.map((r) => r.scenario.length))
  const lines = tl.readings.flatMap((r) => {
    const badge = r.fresh ? '✓ current' : `⚠ stale (${r.staleAxes.join(', ')})`
    const ev = r.blobState === 'present' ? `${r.blobKind === 'transcript' ? 'transcript' : 'image'} ${(r.blob ?? '').slice(0, 12)}…`
      : r.blobState === 'miss' ? 'miss original file' : 'no evidence'
    const head = `  ${r.scenario.padEnd(w)}  ${verdictText(r.verdict)}  ${badge}  ${r.evaluator}  ${r.codeSha.slice(0, 7)}  ${ev}  ${r.ts}`
    return r.expected ? [head, `  ${' '.repeat(w)}  expected: ${r.expected}`] : [head]
  })
  return [`spex yatsu show: '${tl.node}' — ${tl.readings.length} reading(s), newest first`, '', ...lines].join('\n')
}

// @@@ runYatsu - the package's single entrypoint, called by cli.ts's thin `yatsu` route with the arg slice
// after `yatsu`. Routes to a verb and returns the process exit code (the route just exits on it).
export async function runYatsu(args: string[]): Promise<number> {
  const sub = args[0]
  if (sub === 'scan') return scan()
  if (sub === 'eval') return evalCmd(args.slice(1))
  if (sub === 'clean') return clean(args.slice(1))
  if (sub === 'show') return show(args.slice(1))
  if (sub === 'check-staged') return checkStaged()
  console.error('spex yatsu: scan | eval [.|<node>] [--scenario <name>] (--pass|--fail|--note <text>) [--image <path>|--result <path|->] | show [.|<node>] [--json] | clean [--keep-latest|--all]')
  return 2
}
