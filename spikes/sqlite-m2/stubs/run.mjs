// Runs the conformance vectors against each generated counter-example stub and reports which of our
// own assertions fired. A flip that breaks nothing means the vectors do not actually pin that
// decision, which is a gap in the evidence, not a success.
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FLIPS } from './build.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const spikeRoot = join(here, '..')

let ungated = 0
for (const flip of FLIPS) {
  const result = spawnSync(process.execPath, ['--test', 'test/engine.test.mjs', 'test/concurrency.test.mjs'], {
    cwd: spikeRoot,
    env: {
      ...process.env,
      M2_ENGINE: `../stubs/${flip.name}.mjs`,
      M2_BENCH_MS: '300',
      M2_COLD_OPEN_ROUNDS: '6',
    },
    encoding: 'utf8',
    timeout: 240000,
  })
  const out = result.stdout + result.stderr
  // The file-level summary line is not a vector. If it is all we have, the stub failed to load and
  // this is harness noise dressed up as a counter-example.
  const failed = [...out.matchAll(/^✖ (.+?) \(\d/gm)].map(m => m[1])
  const unique = [...new Set(failed)].filter(name => !name.endsWith('.test.mjs'))
  if (unique.length === 0 && failed.length > 0) {
    console.log(`\n### ${flip.name}\n    HARNESS FAILURE, not a counter-example:\n${out.split('\n').slice(0, 12).map(l => '      ' + l).join('\n')}`)
    ungated++
    continue
  }
  console.log(`\n### ${flip.name}`)
  console.log(`    claim: ${flip.claim}`)
  console.log(`    vectors that fired: ${unique.length}`)
  for (const name of unique) console.log(`      - ${name}`)
  if (unique.length === 0) {
    ungated++
    console.log('      !! NOTHING FAILED: this decision is not actually pinned by any vector')
  }
}
console.log(`\nflips gated by at least one vector: ${FLIPS.length - ungated}/${FLIPS.length}`)
process.exitCode = ungated === 0 ? 0 : 1
