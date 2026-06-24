import { readFileSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { repoRoot, headSha, driftIndex, stagedFiles, git } from '../../spec-cli/src/git.js'
import { loadSpecs } from '../../spec-cli/src/specs.js'
import { mainBranch, statePath } from '../../spec-cli/src/layout.js'
import { yatsuNodes, validateScenarios, YATSU_FILE, type YatsuNode } from './yatsu.js'
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

// resolve `.` → the node this worktree works on: the session state's node line, else the `node/<id>`
// branch. Reads through [[portable-layout]]'s statePath so it spans the runtime-dir migration — the new
// `.session/state` file or a legacy flat `.session` — instead of EISDIR-ing on a new session's `.session/` dir.
function currentNodeId(root: string): string | null {
  const sf = statePath(root)
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

// @@@ ui surface - a node has a MEASURABLE frontend surface when its governed code includes a UI file: a
// component/style (.jsx/.tsx/.vue/.svelte/.css) or anything in the dashboard package. Such a node CAN be
// measured (browser YATU) so having NO yatsu.md is a real blind spot — an obvious frontend change with no
// loss signal. A pure-backend node legitimately has none (backend yatsu is still future — see [[spec-yatsu]]).
const UI_FILE = /\.(jsx|tsx|vue|svelte|css)$/
export const isUiPath = (p: string) => UI_FILE.test(p) || p.includes('spec-dashboard/')

// @@@ changedSinceBase - every repo path THIS branch changed since it forked from the main branch
// (committed OR still in the working tree, plus new untracked files), so `scan --changed` can scope the
// loss-signal nudge to the nodes this agent actually touched — never nagging it about a score that went
// stale in a node it never opened. merge-base anchored, so the main branch advancing isn't read as this
// branch's change. Best-effort: a git error (detached, no base) yields ∅ → `--changed` scan stays silent.
function changedSinceBase(root: string): Set<string> {
  const out = new Set<string>()
  const add = (s: string) => { for (const l of s.split('\n')) { const t = l.trim(); if (t) out.add(t) } }
  try {
    const base = git(['-C', root, 'merge-base', mainBranch(), 'HEAD']).trim()
    if (base) add(git(['-C', root, '-c', 'core.quotePath=false', 'diff', '--name-only', base]))
    add(git(['-C', root, '-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard']))
  } catch { /* no base → empty set */ }
  return out
}

// a node is "changed" if the branch touched its node dir (spec.md / yatsu.md / sidecar all live there) or
// any governed code path — matched as an exact file, a directory prefix, or a `*` glob.
export function nodeChanged(dirRel: string, codeFiles: string[], changed: Set<string>): boolean {
  for (const c of changed) if (c === dirRel || c.startsWith(dirRel + '/')) return true
  return codeFiles.some((cf) => {
    if (changed.has(cf)) return true
    const dir = cf.replace(/\/+$/, '') + '/'
    const re = cf.includes('*') ? new RegExp('^' + cf.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$') : null
    for (const c of changed) { if (c.startsWith(dir)) return true; if (re && re.test(c)) return true }
    return false
  })
}

// @@@ scan - the loss signal's BLIND SPOTS, mirroring `spex lint`'s code-drift output (the `•` glyph + one
// line per finding). Four classes: a yatsu.md that violates the scenario schema (a missing required field, a
// typo'd key, a duplicate name) → `yatsu-schema` — a malformed loss function the lenient parser would have
// silently swallowed; a node WITH a valid yatsu.md whose scenario's latest reading went stale (a governed
// code file, the scenario, or the evaluator moved since its codeSha) → `yatsu-drift`; a scenario with no
// reading at all → `yatsu-missing`; a frontend node (UI in its `code:`) with NO yatsu.md → an
// `yatsu-uncovered` loss function that was never written. `--changed` scopes all to the nodes THIS branch
// touched (the proactive Stop gate's view — see [[yatsu-proactive]]); plain scan is the whole-repo coverage
// report. Read-only; exits 0 (a status report) — the gate reads the finding lines, never the code. The
// pre-commit backstop is the HARD twin: it shares validateScenarios and rejects a malformed staged yatsu.md.
async function scan(args: string[] = []): Promise<number> {
  const root = repoRoot()
  const changedOnly = has(args, 'changed')
  const changed = changedOnly ? changedSinceBase(root) : null
  const idx = await driftIndex(root)
  const specs = await loadSpecs()
  // a file may be governed by several nodes — ordinary composition, not a hub to skip (see governed-related).
  // A change to a shared governed file legitimately triggers EVERY governing node's yatsu, mirroring how
  // lint's drift now fans to every owner; nobody's loss signal is suppressed. An over-owned file is lint's
  // `owners` concern (split it), not a reason to go silent here.
  const yByDir = new Map(yatsuNodes(root).map((n) => [relative(root, n.dir), n]))
  let flaggedNodes = 0, malformed = 0, staleScores = 0, missingScores = 0, uncovered = 0
  for (const s of specs) {
    const dirRel = dirname(s.path)
    if (changed && !nodeChanged(dirRel, s.code, changed)) continue
    const y = yByDir.get(dirRel)
    const findings: string[] = []
    if (y) {
      // schema first: a malformed yatsu.md is the loudest gap — report each violation, then still scan its
      // (leniently-parsed) scenarios for stale/missing so a typo doesn't mask a real freshness gap.
      for (const e of validateScenarios(readFileSync(join(y.dir, YATSU_FILE), 'utf8'))) {
        malformed++
        findings.push(`  • yatsu-schema: '${s.id}' ${e} — fix ${y.yatsuPath}`)
      }
      const latest = latestPerScenario(readReadings(y.sidecarPath))
      for (const sc of y.scenarios) {
        // a scenario's own `code` narrows its freshness CODE axis to a subset; a path that does not exist
        // would make that axis silently immortal (changedSince finds no commits for it), so flag it LOUD as a
        // malformed declaration — the same loud-fail spirit as a bad node `code:`.
        const ghosts = (sc.code ?? []).filter((p) => !existsSync(join(root, p)))
        if (ghosts.length) {
          malformed++
          findings.push(`  • yatsu-schema: '${s.id}' scenario '${sc.name}' \`code\` path(s) not found: ${ghosts.join(', ')} — fix ${y.yatsuPath}`)
        }
        const codeFiles = sc.code?.length ? sc.code : s.code   // scenario's own subset, else the node's list
        const r = latest.get(sc.name)
        if (!r) {
          missingScores++
          findings.push(`  • yatsu-missing: '${s.id}' scenario '${sc.name}' has no reading yet — measure with \`spex yatsu eval ${s.id}\``)
          continue
        }
        const axes = staleAxes(r, codeFiles, y.yatsuPath, idx)
        if (axes.length) {
          staleScores++
          findings.push(`  • yatsu-drift: '${s.id}' scenario '${sc.name}' is stale (${axes.join(', ')} moved since ${r.codeSha.slice(0, 7)}) — re-measure with \`spex yatsu eval ${s.id}\``)
        }
      }
    } else if (s.code.some(isUiPath)) {
      uncovered++
      findings.push(`  • yatsu-uncovered: '${s.id}' governs frontend code but has no yatsu.md — give it a scenario (description + expected) so its loss can be measured`)
    }
    if (!findings.length) continue
    flaggedNodes++
    for (const f of findings) console.error(f)
  }
  const scope = changedOnly ? ' --changed' : ''
  console.error(`spex yatsu scan${scope}: ${flaggedNodes} node(s) flagged (${malformed} malformed, ${staleScores} stale, ${missingScores} missing, ${uncovered} uncovered)`)
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

// @@@ check-staged - the pre-commit backstop, two rejections over the staged set (the hook shims to it,
// `spex yatsu check-staged`, like the lint shim). (1) A stray evidence blob: a blob lives in the shared git
// common dir (outside the tree), so the only way one reaches the index is a stray copy into the worktree —
// reject it rather than let binary pixels into git history. (2) A malformed yatsu.md: a staged scenario file
// must satisfy the schema (validateScenarios, the same gate `scan` reports), so a broken loss function — a
// typo'd field, a scenario missing its `expected` — is rejected AT the commit, never landing silently for
// the lenient parser to swallow. Prints every offender, then exits non-zero if either check failed.
function checkStaged(): number {
  const root = repoRoot()
  const staged = stagedFiles(root)
  let bad = false

  const blobs = staged.filter(isStrayBlob)
  if (blobs.length) {
    bad = true
    console.error('✗ SpexCode yatsu: stray evidence blob(s) staged — blobs live in the shared git common dir, never in the tree:')
    for (const o of blobs) console.error(`    ${o}`)
    console.error('  Unstage them (git rm --cached <path>); a reading references its blob by hash, it never commits the bytes.')
  }

  for (const rel of staged.filter((p) => p === YATSU_FILE || p.endsWith('/' + YATSU_FILE))) {
    const abs = join(root, rel)
    if (!existsSync(abs)) continue   // staged deletion — nothing to validate
    const errs = validateScenarios(readFileSync(abs, 'utf8'))
    if (!errs.length) continue
    bad = true
    console.error(`✗ SpexCode yatsu: ${rel} — invalid scenario schema:`)
    for (const e of errs) console.error(`    ${e}`)
  }

  return bad ? 1 : 0
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
  if (sub === 'scan') return scan(args.slice(1))
  if (sub === 'eval') return evalCmd(args.slice(1))
  if (sub === 'clean') return clean(args.slice(1))
  if (sub === 'show') return show(args.slice(1))
  if (sub === 'check-staged') return checkStaged()
  console.error('spex yatsu: scan [--changed] | eval [.|<node>] [--scenario <name>] (--pass|--fail|--note <text>) [--image <path>|--result <path|->] | show [.|<node>] [--json] | clean [--keep-latest|--all]')
  return 2
}
