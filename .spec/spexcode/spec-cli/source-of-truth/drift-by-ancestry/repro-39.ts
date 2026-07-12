// spexcode#39 repro/verify harness for the off-history-probe-repeat-cost scenario:
// builds a scratch repo whose readings' codeSha anchors are ALL off-history (side branch filed
// readings, then the branch was deleted — the adopter history-rewrite shape), then runs
// evalTimeline twice in ONE process and counts git children per pass via GIT_TRACE.
// Expected after the fix: pass 2 (unchanged (sha, path) inputs, warm HEAD-keyed caches) spawns ZERO.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const SCRATCH = '/tmp/spexcode-39-repro'
// defaults reproduce #39 (small corpus); the off-history-probe-memo-scale scenario overrides via env
// to push the distinct (sha, path) probe-key count past the code-axis memos' bound (SPEX39_ANCHORS=600)
const ANCHORS = Number(process.env.SPEX39_ANCHORS || 30)      // orphaned anchor commits
const SCENARIOS = Number(process.env.SPEX39_SCENARIOS || 10)  // scenarios per eval.md
const NODE_DIR = '.spec/proj/thing'

const sh = (args: string[], cwd = SCRATCH) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv() }).trim()
function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_TRACE
  env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = 't'
  env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = 't@t'
  return env
}

const names = Array.from({ length: SCENARIOS }, (_, i) => `s${i + 1}`)
function evalSrc(rev: number): string {
  const items = names.map((n) => [
    `  - name: ${n}`,
    `    tags: [cli]`,
    `    description: measure ${n} rev${rev}`,
    `    expected: ${n} behaves rev${rev}`,
  ].join('\n')).join('\n')
  return `scenarios:\n${items}\n---\n# eval\nmeasured by hand.\n`
}

rmSync(SCRATCH, { recursive: true, force: true })
mkdirSync(join(SCRATCH, NODE_DIR), { recursive: true })
mkdirSync(join(SCRATCH, 'src'), { recursive: true })
sh(['init', '-q', '-b', 'main'])
writeFileSync(join(SCRATCH, '.spec/proj/spec.md'), '---\ntitle: proj\nstatus: active\n---\n# proj\nroot.\n')
writeFileSync(join(SCRATCH, NODE_DIR, 'spec.md'), '---\ntitle: thing\nstatus: active\ncode:\n  - src/app.js\n---\n# thing\nthe thing.\n')
writeFileSync(join(SCRATCH, NODE_DIR, 'eval.md'), evalSrc(0))
writeFileSync(join(SCRATCH, 'src/app.js'), 'export const v = 0\n')
sh(['add', '-A']); sh(['commit', '-q', '-m', 'seed'])

// side branch: each commit edits eval.md + the governed file, so every anchor's tree differs from
// HEAD on both paths; readings anchor here, then the branch is deleted → anchors off-history.
sh(['checkout', '-q', '-b', 'side'])
const anchors: string[] = []
for (let i = 1; i <= ANCHORS; i++) {
  writeFileSync(join(SCRATCH, NODE_DIR, 'eval.md'), evalSrc(i))
  writeFileSync(join(SCRATCH, 'src/app.js'), `export const v = ${i}\n`)
  sh(['add', '-A']); sh(['commit', '-q', '-m', `edit ${i}`])
  anchors.push(sh(['rev-parse', 'HEAD']))
}
sh(['checkout', '-q', 'main'])
sh(['branch', '-q', '-D', 'side'])   // objects remain (no gc) — the "anchor exists, unreachable" state

const readings = anchors.flatMap((sha, i) => names.map((n) =>
  JSON.stringify({ scenario: n, codeSha: sha, verdict: { status: 'pass' }, ts: `2026-07-0${(i % 9) + 1}T00:00:00.000Z` })))
writeFileSync(join(SCRATCH, NODE_DIR, 'evals.ndjson'), readings.join('\n') + '\n')

process.chdir(SCRATCH)
// the engine under measurement — this repo's evaltab, resolved relative to this co-located script
const { evalTimeline } = await import(new URL('../../../../../spec-eval/src/evaltab.js', import.meta.url).href)

function tracePass(label: string): { file: string } {
  const file = `/tmp/spexcode-39-${label}.trace`
  rmSync(file, { force: true })
  process.env.GIT_TRACE = file
  return { file }
}
function count(file: string, pat: RegExp): number {
  if (!existsSync(file)) return 0
  return readFileSync(file, 'utf8').split('\n').filter((l) => pat.test(l)).length
}

for (const pass of [1, 2] as const) {
  const { file } = tracePass(`pass${pass}`)
  const t = Date.now()
  const tl = await evalTimeline('thing')
  const ms = Date.now() - t
  delete process.env.GIT_TRACE
  const spawns = count(file, /trace: built-in:/)
  const revParse = count(file, /trace: built-in: git rev-parse/)
  const catFile = count(file, /trace: built-in: git cat-file/)
  const stale = tl.readings.filter((r) => !r.fresh).length
  console.log(`pass ${pass}: ${ms}ms · git children ${spawns} (rev-parse ${revParse}, cat-file ${catFile}) · readings ${tl.readings.length} (${stale} stale)`)
  if (pass === 2) {
    const ok = spawns === 0
    console.log(ok ? 'PASS: repeat pass over unchanged (sha, path) inputs spawned zero git children'
      : `FAIL: repeat pass re-spawned ${spawns} git children (${revParse} rev-parse) — a content-fallback memo is missing or bounded below the corpus's distinct (sha, path) keys`)
    process.exit(ok ? 0 : 1)
  }
}
