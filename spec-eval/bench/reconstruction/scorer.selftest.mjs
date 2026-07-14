// scorer control gate ([[spec-reconstruction-bench]]) — MUST pass (rc0) and be archived BEFORE any paid run.
// Proves the spec-lint behavioural scorer PASSES the real post-episode lint and REJECTS the pre-state
// (fs-walk) lint. Reads the frozen positive/negative shas from tasks.json (the picked episode + its
// pre-state). Writes runs/pilot/scorer-controls.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scoreControls } from './scorer.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const tasks = JSON.parse(readFileSync(join(HERE, 'tasks.json'), 'utf8'))
const leaf = tasks.leaves.find((l) => l.id === 'spec-lint')
if (!leaf) { console.error('no spec-lint leaf in tasks.json'); process.exit(2) }

const r = scoreControls(ROOT, leaf.episode.sha, leaf.preState)
mkdirSync(join(HERE, 'runs', 'pilot'), { recursive: true })
writeFileSync(join(HERE, 'runs', 'pilot', 'scorer-controls.json'), JSON.stringify({
  scorer: 'behavioral:spec-lint-fixture-run', positiveSha: leaf.episode.sha, negativeSha: leaf.preState, ...r,
}, null, 2) + '\n')

console.log(`scorer controls — discriminates=${r.discriminates}`)
console.log(`  positive(post ${leaf.episode.sha.slice(0, 8)}): ${r.positive.passed}/${r.positive.total} ${r.positive.checks.map((c) => c.name + ':' + (c.ok ? 'ok' : 'FAIL')).join(' ')}`)
console.log(`  negative(pre  ${leaf.preState.slice(0, 8)}): ${r.negative.passed}/${r.negative.total} ${r.negative.checks.map((c) => c.name + ':' + (c.ok ? 'ok' : 'FAIL')).join(' ')}`)
console.log(r.discriminates ? 'scorer-controls ✓ (positive pass, negative rejected)' : 'SCORER CONTROLS FAILED — scorer does not discriminate')
process.exit(r.discriminates ? 0 : 1)
