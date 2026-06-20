// @@@ proof entry - the smallest runnable demonstration of the forge port: drive the github driver's
// read-only listPending() and print the projected issue rows. No network, no writes — a pure projection
// of the spec graph's pending nodes. Run with `npm run proof` (tsx src/proof.ts).
import { githubDriver } from './drivers/github.js'

const rows = await githubDriver.listPending()
console.log(`spec-forge · ${githubDriver.host} · listPending → ${rows.length} pending node(s)\n`)
for (const r of rows) {
  console.log(`#  ${r.title}`)
  console.log(`   labels: ${r.labels.join(', ')}`)
  console.log(`   ${(r.body || '').split('\n')[0]}`)
  console.log()
}
