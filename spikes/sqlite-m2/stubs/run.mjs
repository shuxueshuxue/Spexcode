// Runs the conformance vectors against each generated counter-example stub and reports which of our
// own assertions fired.
//
// The output is deliberately THREE-STATE, because collapsing them is the failure mode this lane kept
// re-learning. "0 vectors fired" used to mean either "the decision is not pinned" or "we never got a
// measurement", and those demand opposite responses:
//
//   GATED       the flip was caught. Named vectors fired; the decision is pinned.
//   UNGATED     we measured, and nothing caught it. The decision has no gate. Real finding.
//   NOT MEASURED the run could not produce a verdict at all -- the stub would not load, the runner
//               timed out, the suite errored before reaching the vectors. NOT evidence of anything.
//
// A flip is also reported as NOT MEASURED when it is caught only intermittently across repeats: a
// gate that fires 8 times in 12 is not a gate, and calling it one is how an ungated decision hid
// here for two rounds.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FLIPS } from './build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const spikeRoot = join(here, '..')
const REPEATS = Number(process.env.M2_FLIP_REPEATS ?? 1)

const runOnce = flip => {
  const result = spawnSync(process.execPath, ['--test', 'test/engine.test.mjs', 'test/concurrency.test.mjs'], {
    cwd: spikeRoot,
    env: {
      ...process.env,
      M2_ENGINE: `../stubs/${flip.name}.mjs`,
      M2_BENCH_MS: '300',
      M2_COLD_OPEN_ROUNDS: '6',
    },
    encoding: 'utf8',
    timeout: 300000,
  })
  const out = result.stdout + result.stderr
  const failed = [...out.matchAll(/^✖ (.+?) \(\d/gm)].map(m => m[1])
  const vectors = [...new Set(failed)].filter(name => !name.endsWith('.test.mjs'))
  const sawSummary = /^ℹ tests \d+/m.test(out) || /^# tests \d+/m.test(out)

  // No usable verdict: the process died, timed out, or never got far enough to run vectors.
  if (result.error || result.status === null || !sawSummary) {
    return { verdict: 'NOT MEASURED', vectors: [], why: result.error ? String(result.error.message) : 'the suite produced no test summary', out }
  }
  // The file-level line alone means the stub failed to load; that is harness noise, not a result.
  if (vectors.length === 0 && failed.length > 0) {
    return { verdict: 'NOT MEASURED', vectors: [], why: 'the stub did not load; only a file-level failure was reported', out }
  }
  return { verdict: vectors.length > 0 ? 'GATED' : 'UNGATED', vectors, why: null, out }
}

const counts = { GATED: 0, UNGATED: 0, 'NOT MEASURED': 0 }
for (const flip of FLIPS) {
  const runs = Array.from({ length: REPEATS }, () => runOnce(flip))
  const gated = runs.filter(r => r.verdict === 'GATED').length
  const unmeasured = runs.filter(r => r.verdict === 'NOT MEASURED').length

  let verdict
  let detail = ''
  if (unmeasured > 0) {
    verdict = 'NOT MEASURED'
    detail = runs.find(r => r.verdict === 'NOT MEASURED').why
  } else if (gated === REPEATS) {
    verdict = 'GATED'
  } else if (gated === 0) {
    verdict = 'UNGATED'
  } else {
    // Caught sometimes. That is not a gate, and must not be reported as one.
    verdict = 'NOT MEASURED'
    detail = `caught in only ${gated}/${REPEATS} repeats — an intermittent catch is not a gate`
  }

  counts[verdict]++
  console.log(`\n### ${flip.name}`)
  console.log(`    claim   : ${flip.claim}`)
  console.log(`    verdict : ${verdict}${REPEATS > 1 ? `  (caught ${gated}/${REPEATS} repeats)` : ''}`)
  if (detail) console.log(`    why     : ${detail}`)
  const vectors = runs.find(r => r.vectors.length > 0)?.vectors ?? []
  for (const name of vectors) console.log(`      - ${name}`)
  if (verdict === 'UNGATED') {
    console.log('      !! measured, and nothing caught it: this decision has no gate')
  }
  if (verdict === 'NOT MEASURED') {
    console.log('      !! no verdict was produced: this is NOT evidence that the decision is fine')
    if (!detail) console.log(runs[0].out.split('\n').slice(0, 10).map(l => '      ' + l).join('\n'))
  }
}

console.log(`\ngated ${counts.GATED}/${FLIPS.length}   ungated ${counts.UNGATED}   not measured ${counts['NOT MEASURED']}`
  + (REPEATS > 1 ? `   (${REPEATS} repeats per flip)` : ''))
process.exitCode = counts.GATED === FLIPS.length ? 0 : 1
