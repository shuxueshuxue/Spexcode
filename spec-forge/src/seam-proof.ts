// @@@ seam proof - the runnable demonstration that the forge PORT is host-agnostic: one code path drives
// BOTH drivers without knowing which host it holds. `listVia` is typed to accept ANY `ForgeDriver`, so
// the github and gitlab drivers flow through the exact same caller — the seam is the shared type, not the
// vendor. If a driver leaked host specifics into its shape, this single function couldn't list both. No
// network, no writes — pure projection. Run with `npm run seam-proof` (tsx src/seam-proof.ts).
import type { ForgeDriver } from './port.js'
import { githubDriver } from './drivers/github.js'
import { gitlabDriver } from './drivers/gitlab.js'

// the caller knows ONLY the port — never which host it is talking to.
async function listVia(driver: ForgeDriver): Promise<void> {
  const rows = await driver.listPending()
  console.log(`spec-forge · ${driver.host} · listPending → ${rows.length} pending node(s)`)
  for (const r of rows) {
    console.log(`  #  ${r.title}`)
    console.log(`     labels: ${r.labels.join(', ')}`)
  }
  console.log()
}

// SAME code path, two hosts — substitutability is what makes one port cover every forge.
for (const driver of [githubDriver, gitlabDriver]) {
  await listVia(driver)
}
