// @@@ outbound proof - the smallest runnable demonstration of the outbound mirror: read the spec graph
// (loadSpecs is the source of truth), project a couple of nodes as PR-shaped mirrors, and print them. No
// network, no writes — a pure projection. Run with `npm run outbound-proof` (tsx src/outbound-proof.ts).
import { loadSpecs } from '../../spec-cli/src/specs.js'
import { mirrorNode } from './outbound.js'

const specs = await loadSpecs()

// pick a couple of nodes spanning different statuses so the status→label + draft mapping is visible —
// one with a branch and one pending (no branch yet) when the graph has both.
const byStatus = (s: string) => specs.find((n) => n.status === s)
const sample = [byStatus('active'), byStatus('pending'), byStatus('merged')].filter((n) => n != null)
const nodes = (sample.length ? sample : specs.slice(0, 2)) as typeof specs

console.log(`spec-forge · outbound mirror · ${nodes.length} node(s)\n`)
for (const n of nodes) {
  const pr = mirrorNode(n)
  console.log(`PR  ${pr.title}${pr.draft ? '  (draft)' : ''}`)
  console.log(`    ${pr.head ?? '(no branch yet)'} → ${pr.base}`)
  console.log(`    labels: ${pr.labels.join(', ')}`)
  console.log(`    ${(pr.body || '').split('\n')[0]}`)
  console.log()
}
